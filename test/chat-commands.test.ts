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
  COMMAND_FORMS,
  COMMAND_GROUPS,
  commandsInGroup,
  convertMeasure,
  formFor,
  initialFormValues,
  missingFields,
  parseMeasure,
  calendarDataEnd,
  planDays,
  planPrompt,
  previewCommand,
  parsePlanDays,
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
    assert.deepEqual(matchCommands('/po').map((c) => c.name), ['porcje', 'pogoda', 'ponow', 'pomoc'])
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

describe('/przelicz — the local measure table', () => {
  const cases: [string, string | undefined][] = [
    // Volume → weight, for an ingredient the table knows.
    ['2 szklanki mąki', '> 2 szklanki mąki ≈ 300 g'],
    ['1 szklanka cukru', '> 1 szklanka cukru ≈ 215 g'],
    ['pół szklanki mleka', '> 0,5 szklanki mleka ≈ 130 g'],
    ['1/2 szklanki ryżu', '> 0,5 szklanki ryżu ≈ 115 g'],
    ['1,5 łyżki miodu', '> 1,5 łyżki miodu ≈ 32 g'],
    ['1 łyżeczka soli', '> 1 łyżeczka soli ≈ 6 g'],
    // Pure volume needs no ingredient at all.
    ['2 szklanki', '> 2 szklanki = 500 ml'],
    ['3 łyżki', '> 3 łyżki = 45 ml'],
    // Weight → the measure a recipe would ask for.
    ['300 g mąki', '> 300 g mąki ≈ 2 szklanki'],
    ['30 dag ryżu', '> 30 dag ryżu ≈ 1,25 szklanki'],
    ['20 g masła', '> 20 g masła ≈ 1 łyżka'],
    ['2 kg', '> 2 kg = 2000 g'],
    // Nothing honest to say → the caller asks the model instead.
    ['2 szklanki komosy ryżowej', undefined],
    ['3 pęczki natki', undefined],
    ['300 g', undefined],
    ['dużo mąki', undefined],
    ['', undefined],
  ]
  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input)}`, () => {
      const result = convertMeasure(input)
      if (expected === undefined) assert.equal(result, undefined)
      else assert.ok(result?.startsWith(expected), `got: ${result}`)
    })
  }

  it('names the density it assumed, so the number can be argued with', () => {
    assert.ok(convertMeasure('2 szklanki mąki')?.includes('mąka pszenna ≈ 60 g/100 ml'))
  })

  it('tells inflected ingredients apart without matching longer words', () => {
    assert.ok(convertMeasure('1 szklanka mąki ziemniaczanej')?.includes('mąka ziemniaczana'))
    assert.ok(convertMeasure('1 szklanka mąki')?.includes('mąka pszenna'))
    assert.equal(convertMeasure('1 szklanka makaronu'), undefined, 'makaron is not mąka')
  })

  it('parses the unit and leaves the rest as the ingredient', () => {
    assert.deepEqual(parseMeasure('2 szklanki mąki pszennej'), {
      amount: 2,
      ml: 250,
      unitLabel: 'szklanki',
      ingredient: 'mąki pszennej',
    })
    assert.equal(parseMeasure('2 kubki mąki'), undefined, 'an unknown unit is not guessed at')
  })
})

describe('/plan', () => {
  const monday = new Date(2026, 8, 21, 9, 0) // 21.09.2026, a Monday

  const events = [
    { title: 'trening', start: new Date(2026, 8, 21, 17, 30).toISOString() },
    { title: 'zebranie', start: new Date(2026, 8, 23, 19, 0).toISOString() },
    { title: 'Święto', start: '2026-09-22', allDay: true },
  ]

  it('buckets events into local days, labelling all-day entries', () => {
    const days = planDays(monday, 3, events)
    assert.equal(days.length, 3)
    assert.deepEqual(days[0]?.entries, ['17:30 trening'])
    assert.deepEqual(days[1]?.entries, ['całodzienne: Święto'])
    assert.deepEqual(days[2]?.entries, ['19:00 zebranie'])
  })

  it('asks with the calendar, the recipe base and the forecast', () => {
    const prompt = planPrompt({
      days: planDays(monday, 4, events),
      recipes: ['Szakszuka', 'Żurek'],
      weather: {
        ageSeconds: 60,
        stale: false,
        data: {
          units: { temperature: '°C', windSpeed: 'km/h' },
          now: { temperature: 17, apparentTemperature: 15, humidity: 70, windSpeed: 10, weatherCode: 3 },
          daily: [
            { date: '2026-09-21', weatherCode: 61, temperatureMax: 19, temperatureMin: 11 },
            { date: '2026-09-22', weatherCode: 0, temperatureMax: 22, temperatureMin: 12 },
          ],
        },
      },
    })
    assert.ok(prompt.includes('Zaplanuj obiady na 4 dni'), prompt)
    assert.ok(prompt.includes('17:30 trening'), prompt)
    assert.ok(prompt.includes('czw 24.09: nic zaplanowanego'), prompt)
    assert.ok(prompt.includes('Przepisy w mojej bazie: Szakszuka; Żurek.'), prompt)
    assert.ok(prompt.includes('11°C–19°C'), prompt)
    assert.ok(prompt.includes('Najpierw sięgaj po przepisy z mojej bazy'), prompt)
  })

  it('omits a section it has no data for rather than implying an empty week', () => {
    const prompt = planPrompt({ days: planDays(monday, 3, []), recipes: [], calendarUnavailable: true })
    assert.ok(!prompt.includes('Kalendarz:'), prompt)
    assert.ok(!prompt.includes('Przepisy w mojej bazie'), prompt)
    assert.ok(!prompt.includes('Pogoda:'), prompt)
    assert.ok(!prompt.includes('bazy'), 'no base means no instruction to prefer it')
  })

  it('marks days past the fetched range as unknown, not as free', () => {
    const prompt = planPrompt({
      days: planDays(monday, 4, events),
      recipes: [],
      calendarUntil: new Date(2026, 8, 23),
    })
    assert.ok(prompt.includes('wt 22.09: całodzienne: Święto'), prompt)
    assert.ok(prompt.includes('śr 23.09: brak danych z kalendarza'), prompt)
    assert.ok(prompt.includes('czw 24.09: brak danych z kalendarza'), prompt)
  })

  it('knows where calendar data stops: the day after today + 60', () => {
    assert.equal(calendarDataEnd(new Date(2026, 8, 21, 23, 0)).getTime(), new Date(2026, 10, 21).getTime(), 'late evening')
    // Crosses the October DST change: still local midnight, not 23:00 or 01:00.
    assert.equal(calendarDataEnd(new Date(2026, 8, 27, 1, 0)).getTime(), new Date(2026, 10, 27).getTime(), 'early morning')
  })

  it('clamps the day count to something a week-shaped plan can carry', () => {
    assert.equal(parsePlanDays('3'), 3)
    assert.equal(parsePlanDays(''), 7)
    assert.equal(parsePlanDays('0'), 7)
    assert.equal(parsePlanDays('30'), 7)
  })
})

describe('/menu forms', () => {
  it('covers every command that takes arguments, and only those', () => {
    const withArgs = COMMANDS.filter((c) => c.args).map((c) => c.name).sort()
    const formed = COMMAND_FORMS.map((f) => f.command).sort()
    assert.deepEqual(formed, withArgs)
  })

  it('every form names a real command and its fields build its argument string', () => {
    for (const form of COMMAND_FORMS) {
      assert.ok(findCommand(form.command), form.command)
      assert.ok(form.fields.length > 0, form.command)
    }
    const convert = formFor('przelicz')!
    assert.equal(convert.build({ ilosc: '2', jednostka: 'szklanka', skladnik: 'mąki' }), '2 szklanka mąki')
    assert.equal(convert.build({ ilosc: '300', jednostka: 'g', skladnik: '' }), '300 g')
    assert.equal(formFor('plan')!.build({ dni: '5' }), '5')
  })

  it('starts from the declared defaults and reports what is still missing', () => {
    const form = formFor('przelicz')!
    const values = initialFormValues(form)
    assert.equal(values.jednostka, 'szklanka')
    assert.equal(values.ilosc, '1')
    assert.deepEqual(missingFields(form, values), [], 'skladnik is optional')
    assert.deepEqual(
      missingFields(form, { ...values, ilosc: '  ' }).map((f) => f.name),
      ['ilosc'],
    )
  })

  it('a required-argument command is never runnable with an empty form', () => {
    for (const form of COMMAND_FORMS) {
      const command = findCommand(form.command)!
      if (!command.argsRequired) continue
      assert.ok(missingFields(form, initialFormValues(form)).length > 0 || form.build(initialFormValues(form)) !== '', form.command)
    }
  })
})

describe('the /menu wizard', () => {
  it('puts every command in exactly one group, and every group in the picker', () => {
    const grouped = COMMAND_GROUPS.flatMap((g) => commandsInGroup(g.id))
    assert.equal(grouped.length, COMMANDS.length, 'no command is unreachable from step 1')
    assert.equal(new Set(grouped.map((c) => c.name)).size, COMMANDS.length, 'and none is listed twice')
    for (const group of COMMAND_GROUPS) assert.ok(commandsInGroup(group.id).length > 0, `${group.id} is empty`)
  })

  it('describes every command in step 2 — a button with no explanation is a button nobody presses', () => {
    for (const c of COMMANDS) {
      assert.ok(c.details.length > 30, `${c.name}: details too thin`)
      assert.ok(c.summary.length > 0 && c.summary.length <= 60, `${c.name}: summary should fit a button`)
      assert.ok(!c.details.includes('  '), `${c.name}: stray double space`)
    }
  })

  it('explains what filling a field in changes, wherever that is not obvious', () => {
    for (const form of COMMAND_FORMS) {
      for (const field of form.fields) {
        if (field.optional) {
          assert.ok(field.help, `${form.command}.${field.name}: an optional field must say what leaving it empty does`)
        }
      }
    }
  })

  it('previews exactly what would have been typed', () => {
    const convert = findCommand('przelicz')!
    assert.equal(previewCommand(convert, '2 szklanka mąki'), '/przelicz 2 szklanka mąki')
    assert.equal(previewCommand(findCommand('koszt')!, ''), '/koszt')
    assert.equal(previewCommand(convert, '  '), '/przelicz', 'a half-filled form previews the bare command')
  })

  it('round-trips: the preview of a built form parses back to the same command and args', () => {
    for (const form of COMMAND_FORMS) {
      const command = findCommand(form.command)!
      const values = initialFormValues(form)
      const args = form.build(values)
      const parsed = parseInput(previewCommand(command, args))
      assert.equal(parsed.kind, 'command', form.command)
      if (parsed.kind === 'command') {
        assert.equal(parsed.command.name, form.command)
        assert.equal(parsed.args, args.trim())
      }
    }
  })
})
