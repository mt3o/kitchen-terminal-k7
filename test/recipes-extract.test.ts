/**
 * The two extraction strategies, tested directly and with no network — the
 * point of keeping them as pure functions in the first place.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { extractFallback, extractJsonLd } from '../src/server/recipes/extract.ts'
import { importRecipeFromUrl, RecipeImportError } from '../src/server/recipes/import.ts'

const SOURCE = 'https://example.test/recipe/nalesniki'

describe('extractJsonLd', () => {
  it('maps a schema.org/Recipe block with HowToStep[] instructions', () => {
    const html = `<!doctype html><html><head>
      <script type="application/ld+json">
        ${JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'Recipe',
          name: 'Naleśniki',
          recipeIngredient: ['2 szklanki mąki', '2 jajka', '1 szklanka mleka'],
          recipeInstructions: [
            { '@type': 'HowToStep', text: 'Wymieszać składniki.' },
            { '@type': 'HowToStep', text: 'Smażyć na patelni.' },
          ],
          keywords: 'śniadanie, szybkie',
          recipeCategory: 'deser',
        })}
      </script>
    </head><body><h1>Naleśniki</h1></body></html>`

    const recipe = extractJsonLd(html, SOURCE)
    assert.ok(recipe)
    assert.equal(recipe.title, 'Naleśniki')
    assert.deepEqual(recipe.ingredients, ['2 szklanki mąki', '2 jajka', '1 szklanka mleka'])
    assert.deepEqual(recipe.steps, ['Wymieszać składniki.', 'Smażyć na patelni.'])
    assert.deepEqual(recipe.tags, ['śniadanie', 'szybkie', 'deser'])
    assert.equal(recipe.sourceUrl, SOURCE)
  })

  it('maps a bare-string recipeInstructions block split on newlines', () => {
    const html = `<!doctype html><html><head>
      <script type="application/ld+json">
        ${JSON.stringify({
          '@type': 'Recipe',
          name: 'Zupa',
          recipeIngredient: ['woda', 'sol'],
          recipeInstructions: 'Zagotuj wode.\nDodaj sol.',
        })}
      </script>
    </head><body></body></html>`

    const recipe = extractJsonLd(html, SOURCE)
    assert.deepEqual(recipe?.steps, ['Zagotuj wode.', 'Dodaj sol.'])
  })

  it('finds a Recipe node nested under @graph', () => {
    const html = `<!doctype html><html><head>
      <script type="application/ld+json">
        ${JSON.stringify({
          '@context': 'https://schema.org',
          '@graph': [
            { '@type': 'WebPage', name: 'Blog o jedzeniu' },
            { '@type': ['Recipe', 'Thing'], name: 'Kotlet', recipeIngredient: ['mieso'], recipeInstructions: ['Usmaz.'] },
          ],
        })}
      </script>
    </head><body></body></html>`

    const recipe = extractJsonLd(html, SOURCE)
    assert.equal(recipe?.title, 'Kotlet')
  })

  it('returns undefined when there is no JSON-LD at all', () => {
    const html = `<!doctype html><html><body><h1>Just a page</h1></body></html>`
    assert.equal(extractJsonLd(html, SOURCE), undefined)
  })

  it('skips a malformed JSON-LD block instead of throwing', () => {
    const html = `<!doctype html><html><head>
      <script type="application/ld+json">{ not valid json </script>
    </head><body></body></html>`
    assert.equal(extractJsonLd(html, SOURCE), undefined)
  })
})

describe('extractFallback', () => {
  it('isolates the article and guesses ingredients-then-steps from consecutive lists', () => {
    const html = `<!doctype html><html><head><title>Przepis</title>
      <meta name="keywords" content="obiad, tradycyjne">
      </head><body>
      <nav><ul><li>Strona glowna</li><li>Kontakt</li></ul></nav>
      <article>
        <h1>Bigos tradycyjny</h1>
        <p>${'To jest klasyczny przepis na bigos, przekazywany od pokolen w polskich domach. '.repeat(6)}</p>
        <p>${'Przygotowanie zajmuje troche czasu, ale efekt jest tego wart, zwlaszcza zima. '.repeat(6)}</p>
        <h2>Skladniki</h2>
        <ul>
          <li>1 kg kapusty kiszonej</li>
          <li>0.5 kg kapusty swiezej</li>
          <li>300 g wedzonki</li>
          <li>2 cebule</li>
        </ul>
        <h2>Przygotowanie</h2>
        <ol>
          <li>Poszatkuj kapuste swieza.</li>
          <li>Wymieszaj obie kapusty w garnku.</li>
          <li>Dodaj wedzonke i cebule.</li>
          <li>Dus na wolnym ogniu przez dwie godziny.</li>
        </ol>
        <p>${'Bigos smakuje jeszcze lepiej odgrzewany nastepnego dnia, po przegryzieniu sie smakow. '.repeat(4)}</p>
      </article>
    </body></html>`

    const recipe = extractFallback(html, SOURCE)
    assert.ok(recipe, 'Readability should have found an article')
    assert.equal(recipe.ingredients.length, 4)
    assert.ok(recipe.ingredients.includes('1 kg kapusty kiszonej'))
    assert.equal(recipe.steps.length, 4)
    assert.ok(recipe.steps.includes('Dus na wolnym ogniu przez dwie godziny.'))
    assert.deepEqual(recipe.tags, ['obiad', 'tradycyjne'])
    assert.equal(recipe.sourceUrl, SOURCE)
  })

  it('returns undefined for a page with no article-shaped content', () => {
    const html = `<!doctype html><html><body><p>hi</p></body></html>`
    assert.equal(extractFallback(html, SOURCE), undefined)
  })

  it('returns undefined for a readable article with no ingredient-shaped list, rather than a title-only recipe', () => {
    // This is the exact shape example.com-style pages take: Readability
    // happily finds a title and an article body, but there is no list at all
    // — so this must fail extraction, not succeed with empty ingredients.
    const html = `<!doctype html><html><head><title>Blog o gotowaniu</title></head><body>
      <article>
        <h1>Dlaczego uwielbiam gotowac</h1>
        <p>${'To jest artykul o moich przemysleniach na temat gotowania i jedzenia w domu. '.repeat(8)}</p>
        <p>${'Nie ma tu jednak zadnego konkretnego przepisu, tylko luzne rozwazania. '.repeat(8)}</p>
      </article>
    </body></html>`
    assert.equal(extractFallback(html, SOURCE), undefined)
  })
})

describe('importRecipeFromUrl', () => {
  it('prefers JSON-LD over the fallback when both would apply', async () => {
    const html = `<!doctype html><html><head>
      <script type="application/ld+json">
        ${JSON.stringify({ '@type': 'Recipe', name: 'Z JSON-LD', recipeIngredient: ['x'], recipeInstructions: ['y'] })}
      </script>
    </head><body></body></html>`
    const recipe = await importRecipeFromUrl(SOURCE, { fetcher: async () => ({ text: async () => html }) })
    assert.equal(recipe.title, 'Z JSON-LD')
  })

  it('rejects a non-http(s) scheme before ever fetching', async () => {
    let called = false
    await assert.rejects(
      () =>
        importRecipeFromUrl('ftp://example.test/x', {
          fetcher: async () => {
            called = true
            return { text: async () => '' }
          },
        }),
      RecipeImportError,
    )
    assert.equal(called, false)
  })

  it('rejects a private-address host without fetching', async () => {
    await assert.rejects(
      () => importRecipeFromUrl('http://192.168.1.5/recipe', { fetcher: async () => ({ text: async () => '' }) }),
      RecipeImportError,
    )
  })

  it('reports a fetch failure distinctly from an extraction failure', async () => {
    await assert.rejects(
      () =>
        importRecipeFromUrl(SOURCE, {
          fetcher: async () => {
            throw new Error('timed out')
          },
        }),
      (err: unknown) => err instanceof RecipeImportError && err.reason === 'fetch-failed',
    )
  })

  it('reports extraction failure when neither strategy finds a recipe', async () => {
    await assert.rejects(
      () =>
        importRecipeFromUrl(SOURCE, {
          fetcher: async () => ({ text: async () => '<!doctype html><html><body><p>hi</p></body></html>' }),
        }),
      (err: unknown) => err instanceof RecipeImportError && err.reason === 'extraction-failed',
    )
  })
})
