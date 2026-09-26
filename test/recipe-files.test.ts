/**
 * The file-backed recipe collection: the Markdown format has to round-trip
 * what the app writes and still read what a person typed by hand; the
 * repository has to honour the same port contract the SQLite one does and
 * never let an id name a file outside its directory; and the one-time
 * migration has to run exactly once, even after the household empties the
 * directory on purpose.
 */
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'

import { createRepositories, openDatabase } from '../src/server/adapters/drizzle/index.ts'
import { createFileRecipeRepository, migrateRecipesToFiles } from '../src/server/adapters/files/recipes.ts'
import { loadConfig } from '../src/server/config.ts'
import { runMigrations } from '../src/server/db/migrate.ts'
import type { Recipe } from '../src/server/domain/types.ts'
import { parseRecipeMarkdown, serializeRecipe, slugify } from '../src/server/recipes/markdown-format.ts'

const MTIME = new Date('2026-01-02T03:04:05.000Z')

const zurek: Recipe = {
  id: 'zurek',
  title: 'Żurek z jajkiem',
  description: 'Wielkanocna zupa na zakwasie, z białą kiełbasą i jajkiem.',
  sourceUrl: 'https://example.test/żurek',
  ingredients: ['500 ml zakwasu', 'biała kiełbasa', '4 jajka'],
  steps: ['Zagotować wodę z zakwasem.', 'Dodać kiełbasę i gotować 20 minut.'],
  tags: ['zupa', 'wielkanoc'],
  importedAt: new Date('2026-04-05T10:30:00.000Z'),
}

const draft = (title: string, extra: Partial<Recipe> = {}): Omit<Recipe, 'importedAt'> => ({
  id: '',
  title,
  description: '',
  sourceUrl: null,
  ingredients: [],
  steps: [],
  tags: [],
  ...extra,
})

describe('markdown format', () => {
  it('round-trips a recipe, Polish diacritics included', () => {
    const text = serializeRecipe(zurek)
    assert.deepEqual(parseRecipeMarkdown(text, { id: 'zurek', mtime: MTIME }), zurek)
  })

  it('writes the documented layout', () => {
    const text = serializeRecipe(zurek)
    assert.match(text, /^---\ntitle: Żurek z jajkiem\n/)
    assert.match(
      text,
      /\n---\n\n## Opis\n\nWielkanocna zupa na zakwasie, z białą kiełbasą i jajkiem\.\n\n## Składniki\n\n- 500 ml zakwasu\n- biała kiełbasa\n- 4 jajka\n\n## Kroki\n\n1\. Zagotować/,
    )
    assert.ok(text.endsWith('2. Dodać kiełbasę i gotować 20 minut.\n'))
  })

  it('splits a multi-line description onto its own lines under ## Opis', () => {
    const text = serializeRecipe({ ...zurek, description: 'Pierwsza linia.\nDruga linia.' })
    assert.match(text, /\n---\n\n## Opis\n\nPierwsza linia\.\nDruga linia\.\n\n## Składniki\n/)
    assert.equal(parseRecipeMarkdown(text, { id: 'zurek', mtime: MTIME }).description, 'Pierwsza linia.\nDruga linia.')
  })

  it('collapses a line break inside an item to one space', () => {
    const text = serializeRecipe({ ...zurek, steps: ['Wymieszać\n  i odstawić', 'Podać'] })
    assert.deepEqual(parseRecipeMarkdown(text, { id: 'zurek', mtime: MTIME }).steps, ['Wymieszać i odstawić', 'Podać'])
  })

  it('omits a null sourceUrl, an empty description, and keeps both headings for empty lists', () => {
    const empty: Recipe = { ...zurek, description: '', sourceUrl: null, ingredients: [], steps: [], tags: [] }
    const text = serializeRecipe(empty)
    assert.doesNotMatch(text, /sourceUrl/)
    // No description at all means no ## Opis section — file shape stays exactly what it was before this field existed.
    assert.doesNotMatch(text, /Opis/)
    assert.match(text, /## Składniki\n\n## Kroki\n$/)
    assert.deepEqual(parseRecipeMarkdown(text, { id: 'zurek', mtime: MTIME }), empty)
  })

  it('reads a hand-written file with no frontmatter', () => {
    const text = [
      '# Pierogi ruskie',
      '',
      'Babcina wersja, nie ruszać.',
      '',
      '## Skladniki',
      '',
      '* 500 g mąki',
      '* 1 kg ziemniaków',
      '  najlepiej mączystych',
      '* twaróg',
      '',
      '### Ciasto',
      '',
      '+ woda',
      '',
      '## Notatki',
      '',
      '- to nie jest składnik',
      '',
      '## Sposób przygotowania:',
      '',
      '1) Ugotować ziemniaki.',
      '2) Zmielić z twarogiem.',
      'Lepić i gotować, aż wypłyną.',
    ].join('\n')

    const recipe = parseRecipeMarkdown(text, { id: 'Pierogi ruskie', mtime: MTIME })

    assert.equal(recipe.id, 'Pierogi ruskie')
    assert.equal(recipe.title, 'Pierogi ruskie')
    assert.deepEqual(recipe.ingredients, ['500 g mąki', '1 kg ziemniaków najlepiej mączystych', 'twaróg', 'woda'])
    assert.deepEqual(recipe.steps, ['Ugotować ziemniaki.', 'Zmielić z twarogiem.', 'Lepić i gotować, aż wypłyną.'])
    assert.deepEqual(recipe.tags, [])
    assert.equal(recipe.sourceUrl, null)
    assert.deepEqual(recipe.importedAt, MTIME, 'no importedAt in the file falls back to its mtime')
  })

  it('reads a hand-typed Opis section as the description, English heading included', () => {
    const pl = parseRecipeMarkdown('## Opis\n\nSzybki obiad na jeden garnek.\n\n## Skladniki\n\n- ryz\n', {
      id: 'x',
      mtime: MTIME,
    })
    assert.equal(pl.description, 'Szybki obiad na jeden garnek.')

    const en = parseRecipeMarkdown('## Description\n\nOne-pot dinner.\n\n## Ingredients\n\n- rice\n', {
      id: 'x',
      mtime: MTIME,
    })
    assert.equal(en.description, 'One-pot dinner.')
  })

  it('known simplification: a blank line inside Opis does not survive as a paragraph break', () => {
    const text = '## Opis\n\nPierwszy akapit.\n\nDrugi akapit.\n\n## Skladniki\n\n- sol\n'
    const recipe = parseRecipeMarkdown(text, { id: 'x', mtime: MTIME })
    // The blank line is dropped by the shared section parser, not preserved — documented in plan.md Phase 1.
    assert.equal(recipe.description, 'Pierwszy akapit.\nDrugi akapit.')
  })

  it('known simplification: a leading dash on an Opis line is read as a list marker and stripped', () => {
    const text = '## Opis\n\n- wazne: mrozi sie dobrze\n\n## Skladniki\n\n- sol\n'
    const recipe = parseRecipeMarkdown(text, { id: 'x', mtime: MTIME })
    assert.equal(recipe.description, 'wazne: mrozi sie dobrze')
  })

  it('falls back to the file name when there is neither a title nor an H1', () => {
    const recipe = parseRecipeMarkdown('## Kroki\n\n- zjeść\n', { id: 'bez-tytulu', mtime: MTIME })
    assert.equal(recipe.title, 'bez-tytulu')
    assert.deepEqual(recipe.steps, ['zjeść'])
  })

  it('accepts tags as a comma-separated string and ignores an unparseable date', () => {
    const text = '---\ntitle: Sernik\ntags: deser, święta ,  \nimportedAt: kiedyś\n---\n'
    const recipe = parseRecipeMarkdown(text, { id: 'sernik', mtime: MTIME })
    assert.deepEqual(recipe.tags, ['deser', 'święta'])
    assert.deepEqual(recipe.importedAt, MTIME)
  })

  it('throws on malformed frontmatter so the caller can skip the file', () => {
    assert.throws(() => parseRecipeMarkdown('---\ntitle: [niedomknięte\n---\n', { id: 'x', mtime: MTIME }))
    assert.throws(() => parseRecipeMarkdown('---\ntitle: nigdy nie zamknięte\n', { id: 'x', mtime: MTIME }))
    assert.throws(() => parseRecipeMarkdown('---\n- lista\n---\n', { id: 'x', mtime: MTIME }))
  })
})

describe('slugify', () => {
  it('transliterates Polish letters, ł included', () => {
    assert.equal(slugify('Żurek z jajkiem'), 'zurek-z-jajkiem')
    assert.equal(slugify('Łosoś'), 'losos')
    assert.equal(slugify('  Gęś — pieczona!  '), 'ges-pieczona')
  })

  it('falls back to a fixed stem and caps the length', () => {
    assert.equal(slugify(''), 'przepis')
    assert.equal(slugify('!!!'), 'przepis')
    assert.ok(slugify('a'.repeat(200)).length <= 80)
  })
})

describe('file RecipeRepository', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'k7-recipe-files-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('names a new recipe by its title slug and reads it back', async () => {
    const repo = createFileRecipeRepository(dir)
    const saved = await repo.save(draft('Żurek z jajkiem', { ingredients: ['zakwas'], tags: ['zupa'] }))

    assert.equal(saved.id, 'zurek-z-jajkiem')
    assert.ok(saved.importedAt instanceof Date)
    assert.deepEqual(await readdir(dir), ['zurek-z-jajkiem.md'])
    assert.deepEqual(await repo.get(saved.id), saved)
  })

  it('gives a second recipe with the same title a numbered id', async () => {
    const repo = createFileRecipeRepository(dir)
    const first = await repo.save(draft('Sernik'))
    const second = await repo.save(draft('Sernik'))
    const third = await repo.save(draft('Sernik'))
    assert.deepEqual([first.id, second.id, third.id], ['sernik', 'sernik-2', 'sernik-3'])
  })

  it('lists newest first, filters by tag before applying the limit', async () => {
    const repo = createFileRecipeRepository(dir)
    await repo.save({ ...draft('Stary obiad', { tags: ['obiad'] }), importedAt: new Date('2026-01-01') })
    await repo.save({ ...draft('Deser', { tags: ['deser'] }), importedAt: new Date('2026-03-01') })
    await repo.save({ ...draft('Nowy obiad', { tags: ['obiad'] }), importedAt: new Date('2026-02-01') })

    assert.deepEqual((await repo.list()).map((r) => r.title), ['Deser', 'Nowy obiad', 'Stary obiad'])
    assert.deepEqual((await repo.list({ limit: 2 })).map((r) => r.title), ['Deser', 'Nowy obiad'])
    assert.deepEqual((await repo.list({ tag: 'obiad', limit: 2 })).map((r) => r.title), ['Nowy obiad', 'Stary obiad'])
    assert.deepEqual((await repo.list({ tag: 'obiad', limit: 1 })).map((r) => r.title), ['Nowy obiad'])
  })

  it('skips and reports a file it cannot read instead of failing the list', async () => {
    const invalid: string[] = []
    const repo = createFileRecipeRepository(dir, { onInvalid: (file) => invalid.push(file) })
    await repo.save(draft('Dobry'))
    await writeFile(join(dir, 'zepsuty.md'), '---\ntitle: [\n---\n')
    await writeFile(join(dir, 'notatki.txt'), 'nie przepis')
    await writeFile(join(dir, '.ukryty.md'), '# ukryty')

    assert.deepEqual((await repo.list()).map((r) => r.title), ['Dobry'])
    assert.deepEqual(invalid, ['zepsuty.md'])
  })

  it('picks up a hand-made file, spaces and diacritics in the name included', async () => {
    const repo = createFileRecipeRepository(dir)
    await writeFile(join(dir, 'Pierogi ruskie.md'), '## Składniki\n\n- ziemniaki\n')
    const got = await repo.get('Pierogi ruskie')
    assert.equal(got?.title, 'Pierogi ruskie')
    assert.deepEqual(got?.ingredients, ['ziemniaki'])
    assert.equal((await repo.list()).length, 1)
  })

  it('keeps importedAt when a recipe is edited', async () => {
    const repo = createFileRecipeRepository(dir)
    const original = await repo.save({ ...draft('Bigos'), importedAt: new Date('2025-12-24T12:00:00.000Z') })
    const edited = await repo.save({ ...draft('Bigos', { steps: ['dusić trzy dni'] }), id: original.id })

    assert.equal(edited.id, original.id)
    assert.deepEqual(edited.importedAt, original.importedAt)
    assert.deepEqual((await repo.get(original.id))?.steps, ['dusić trzy dni'])
    assert.equal((await readdir(dir)).length, 1, 'no temp file left behind')
  })

  it('deletes once and reports the miss on a repeat', async () => {
    const repo = createFileRecipeRepository(dir)
    const saved = await repo.save(draft('Kompot'))
    assert.equal(await repo.delete(saved.id), true)
    assert.equal(await repo.delete(saved.id), false)
    assert.equal(await repo.get(saved.id), undefined)
  })

  it('treats a directory that does not exist yet as an empty collection', async () => {
    const repo = createFileRecipeRepository(join(dir, 'nie', 'ma'))
    assert.deepEqual(await repo.list(), [])
    assert.equal(await repo.get('cokolwiek'), undefined)
  })

  it('never lets an id name a file outside the directory', async () => {
    const repo = createFileRecipeRepository(join(dir, 'recipes'))
    await writeFile(join(dir, 'x.md'), '# poza kolekcją')

    for (const id of ['../x', '.hidden', 'a/b', '..', 'a\\b', 'x\0y']) {
      assert.equal(await repo.get(id), undefined, `get(${JSON.stringify(id)})`)
      assert.equal(await repo.delete(id), false, `delete(${JSON.stringify(id)})`)
      await assert.rejects(repo.save({ ...draft('Wyłom'), id }), `save(${JSON.stringify(id)})`)
    }
    assert.equal(await readFile(join(dir, 'x.md'), 'utf8'), '# poza kolekcją', 'the file outside survived')
    assert.deepEqual(await readdir(dir), ['x.md'], 'a refused save wrote nothing anywhere')
  })
})

describe('migrateRecipesToFiles', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'k7-recipe-migrate-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const sqliteRecipes = () => {
    const db = openDatabase(':memory:')
    runMigrations(db)
    return createRepositories(db).recipes
  }

  it('copies every row once, keeping dates and tags, and never runs again', async () => {
    const source = sqliteRecipes()
    await source.save({ ...draft('Sernik', { tags: ['deser'] }), importedAt: new Date('2025-11-01T08:00:00.000Z') })
    await source.save({ ...draft('Sernik', { sourceUrl: 'https://example.test/inny' }), importedAt: new Date('2025-12-01T08:00:00.000Z') })
    await source.save({ ...draft('Łosoś pieczony'), importedAt: new Date('2026-01-01T08:00:00.000Z') })

    const target = join(dir, 'przepisy')
    assert.deepEqual(await migrateRecipesToFiles(source, target), { migrated: 3, skipped: 0 })

    const repo = createFileRecipeRepository(target)
    const listed = await repo.list()
    assert.deepEqual(listed.map((r) => r.id), ['losos-pieczony', 'sernik-2', 'sernik'])
    const older = await repo.get('sernik')
    assert.ok(older, 'the first-saved of two same-titled rows keeps the unnumbered name')
    assert.deepEqual(older?.tags, ['deser'])
    assert.deepEqual(older?.importedAt, new Date('2025-11-01T08:00:00.000Z'))
    assert.equal((await repo.get('sernik-2'))?.sourceUrl, 'https://example.test/inny')
    assert.match(await readFile(join(target, '.migrated-from-sqlite'), 'utf8'), /^\d{4}-\d\d-\d\dT.* migrated=3/)

    assert.equal(await migrateRecipesToFiles(source, target), undefined, 'second run did something')

    for (const name of await readdir(target)) if (name.endsWith('.md')) await unlink(join(target, name))
    assert.equal(await migrateRecipesToFiles(source, target), undefined, 'an emptied collection was refilled')
    assert.deepEqual(await repo.list(), [])
  })

  it('does not duplicate what an interrupted earlier run already copied', async () => {
    const source = sqliteRecipes()
    const row = await source.save({ ...draft('Bigos'), importedAt: new Date('2025-12-24T12:00:00.000Z') })
    await source.save({ ...draft('Kompot'), importedAt: new Date('2025-12-25T12:00:00.000Z') })
    await createFileRecipeRepository(dir).save({ ...row, id: 'bigos' })

    assert.deepEqual(await migrateRecipesToFiles(source, dir), { migrated: 1, skipped: 1 })
    assert.deepEqual((await readdir(dir)).filter((n) => n.endsWith('.md')).sort(), ['bigos.md', 'kompot.md'])
  })
})

describe('recipesDir config', () => {
  it('defaults to the XDG data directory under HOME, outside the checkout', () => {
    assert.equal(loadConfig({ HOME: '/home/x' }).recipesDir, '/home/x/.local/share/kitchen-terminal-k7/przepisy')
  })

  it('honours XDG_DATA_HOME, and K7_RECIPES_DIR over both', () => {
    assert.equal(
      loadConfig({ HOME: '/home/x', XDG_DATA_HOME: '/srv/data' }).recipesDir,
      '/srv/data/kitchen-terminal-k7/przepisy',
    )
    assert.equal(
      loadConfig({ HOME: '/home/x', XDG_DATA_HOME: '/srv/data', K7_RECIPES_DIR: '/mnt/nas/przepisy' }).recipesDir,
      '/mnt/nas/przepisy',
    )
  })

  it('treats an empty K7_RECIPES_DIR as unset and falls back to ./data without a HOME', () => {
    assert.equal(loadConfig({ HOME: '/home/x', K7_RECIPES_DIR: '' }).recipesDir, '/home/x/.local/share/kitchen-terminal-k7/przepisy')
    assert.equal(loadConfig({}).recipesDir, './data/przepisy')
  })
})
