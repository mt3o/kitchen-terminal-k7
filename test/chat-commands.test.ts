import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  COMMANDS,
  contextBar,
  findCommand,
  formatContextReport,
  formatDuration,
  fridgePrompt,
  helpText,
  linkDurations,
  matchCommands,
  parseDuration,
  parseInput,
  parseServings,
  portionsPrompt,
  titleFrom,
  weatherPrompt,
  type ContextReport,
  type WeatherSnapshot,
} from '../src/client/lib/chat-commands.ts'
import { renderMarkdown } from '../src/client/lib/markdown.ts'

describe('parseInput', () => {
  it('passes plain text through as a message', () => {
    assert.deepEqual(parseInput('  co na obiad?  '), { kind: 'message', content: 'co na obiad?' })
  })

  it('runs a command with its arguments, by name or alias, diacritics folded', () => {
    const minutnik = parseInput('/minutnik 7:30')
    assert.equal(minutnik.kind, 'command')
    assert.equal(minutnik.kind === 'command' && minutnik.command.name, 'minutnik')
    assert.equal(minutnik.kind === 'command' && minutnik.args, '7:30')

    const lodowka = parseInput('/Lodówka jajka, szpinak')
    assert.equal(lodowka.kind === 'command' && lodowka.command.name, 'lodowka')
    assert.equal(lodowka.kind === 'command' && lodowka.args, 'jajka, szpinak')

    assert.equal(findCommand('nowa')?.name, 'clear')
    assert.equal(findCommand('tytuł')?.name, 'tytul')
    assert.equal(findCommand('kontekst')?.name, 'context')
  })

  it('reports an unknown command rather than sending it to the model', () => {
    assert.deepEqual(parseInput('/xyz 1'), { kind: 'unknown', name: 'xyz' })
  })

  it('sends //text literally with one slash', () => {
    assert.deepEqual(parseInput('//etc/hosts to plik'), { kind: 'message', content: '/etc/hosts to plik' })
  })

  it('has no name or alias claimed twice', () => {
    const names = COMMANDS.flatMap((c) => [c.name, ...c.aliases])
    assert.equal(new Set(names).size, names.length)
  })
})

describe('matchCommands / helpText', () => {
  it('filters the chip row by prefix, aliases included', () => {
    assert.deepEqual(matchCommands('/po').map((c) => c.name), ['porcje', 'pogoda', 'pomoc'])
    assert.deepEqual(matchCommands('/now').map((c) => c.name), ['clear'])
    assert.equal(matchCommands('zwykly tekst').length, COMMANDS.length)
  })

  it('lists every command', () => {
    const help = helpText()
    for (const c of COMMANDS) assert.ok(help.includes(`/${c.name}`), c.name)
  })
})

describe('parseDuration', () => {
  const cases: [string, number | undefined][] = [
    ['10', 600],
    ['1,5', 90],
    ['7:30', 450],
    ['1:05:00', 3900],
    ['90s', 90],
    ['90 sek', 90],
    ['10 min', 600],
    ['10 minut', 600],
    ['1h', 3600],
    ['1,5 h', 5400],
    ['2 godz.', 7200],
    ['1h 15min', 4500],
    ['2 godziny 10 minut', 7800],
    ['0', undefined],
    ['7:75', undefined],
    ['900h', undefined],
    ['10 lat', undefined],
    ['pieć', undefined],
    ['', undefined],
  ]
  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input)} → ${expected}`, () => assert.equal(parseDuration(input), expected))
  }

  it('formats as mm:ss, or h:mm:ss past an hour', () => {
    assert.equal(formatDuration(450), '07:30')
    assert.equal(formatDuration(3900), '1:05:00')
  })
})

describe('linkDurations', () => {
  const secondsIn = (html: string): string[] => [...html.matchAll(/data-seconds="(\d+)"/g)].map((m) => m[1] ?? '')

  it('turns durations in rendered text into timer buttons', () => {
    const html = linkDurations(renderMarkdown('Gotuj 12 minut, potem piecz 40-45 min w 180 stopniach.'))
    assert.deepEqual(secondsIn(html), ['720', '2400'])
    assert.ok(html.includes('>40-45 min</button>'), 'the whole range stays the label')
  })

  it('leaves code, links and look-alike words alone', () => {
    const html = linkDurations(renderMarkdown('`sleep 5 s` i [10 min](https://example.com) oraz 2 szklanki i 3 minerały'))
    assert.deepEqual(secondsIn(html), [])
  })

  it('handles hours and decimals', () => {
    assert.deepEqual(secondsIn(linkDurations(renderMarkdown('Duś 1,5 godziny albo 2 h.'))), ['5400', '7200'])
  })
})

describe('prompt templates', () => {
  it('portions: whole servings 1-50 only, Polish plural', () => {
    assert.equal(parseServings('4'), 4)
    assert.equal(parseServings('0'), undefined)
    assert.equal(parseServings('2.5'), undefined)
    assert.equal(parseServings('500'), undefined)
    assert.ok(portionsPrompt(1).includes('1 porcję'))
    assert.ok(portionsPrompt(4).includes('4 porcje'))
    assert.ok(portionsPrompt(12).includes('12 porcji'))
  })

  it('fridge: names the products', () => {
    assert.ok(fridgePrompt(' jajka, feta ').startsWith('Mam w lodówce: jajka, feta.'))
  })

  it('weather: a readable sentence, never raw JSON, flags stale data', () => {
    const weather: WeatherSnapshot = {
      ageSeconds: 3 * 3600,
      stale: true,
      data: {
        units: { temperature: '°C', windSpeed: 'km/h' },
        now: { temperature: 17.6, apparentTemperature: 15.2, humidity: 71, windSpeed: 12.4, weatherCode: 3 },
        daily: [
          { date: '2026-09-18', weatherCode: 61, temperatureMax: 19.6, temperatureMin: 11.2 },
          { date: '2026-09-19', weatherCode: 0, temperatureMax: 22, temperatureMin: 12 },
        ],
      },
    }
    const prompt = weatherPrompt(weather, '')
    assert.ok(prompt.includes('teraz 18°C (odczuwalna 15°C)'), prompt)
    assert.ok(prompt.includes('11°C–20°C'), prompt)
    assert.ok(prompt.includes('ostatni odczyt 3 godz. temu'), prompt)
    assert.ok(!prompt.includes('{'))
    assert.ok(weatherPrompt(weather, 'czy grillować?').endsWith('czy grillować?'))
  })

  it('titles fit an archive row', () => {
    assert.equal(titleFrom('  krótki  '), 'krótki')
    assert.equal(titleFrom('x'.repeat(100)).length, 60)
  })
})

describe('/context readout', () => {
  const report: ContextReport = {
    model: 'anthropic/claude-sonnet-5',
    contextLengthKnown: true,
    contextLength: 200_000,
    reservedForResponseTokens: 40_000,
    historyBudgetTokens: 160_000,
    compactingTriggerTokens: 128_000,
    windowTokens: 40_000,
    windowMessages: 6,
    totalMessages: 14,
    compacted: true,
  }

  it('draws the window as used / free / compaction mark / reserve', () => {
    assert.equal(contextBar(report, 10), '[##----|-..]')
    assert.equal(contextBar({ ...report, windowTokens: 0 }, 10), '[------|-..]')
    assert.equal(contextBar({ ...report, windowTokens: 1 }, 10), '[#-----|-..]', 'any use shows at least one cell')
  })

  it('reports budget share, reserve and the compaction point', () => {
    const text = formatContextReport(report, 'en-US')
    assert.ok(text.includes('25% budzetu historii'), text)
    assert.ok(text.includes('~40,000 tok. // 6 z 14 wiad. // od streszczenia'), text)
    assert.ok(text.includes('rezerwa na odpowiedz: 40,000 tok. (20%)'), text)
    assert.ok(text.includes('kompaktowanie od: ~128,000 tok. (80% budzetu)'), text)
  })

  it('says an empty thread is empty and a guessed window is a guess', () => {
    const text = formatContextReport({ ...report, windowTokens: 0, windowMessages: 0, totalMessages: 0, contextLengthKnown: false })
    assert.ok(text.includes('okno: puste (nowa rozmowa)'))
    assert.ok(text.includes('zalozone'))
  })
})
