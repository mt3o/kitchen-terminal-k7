/**
 * The chat card's harness commands — everything about them that can be
 * decided without a DOM or a network: the registry, the parser, the prompt
 * templates, duration parsing, and the `/context` readout.
 *
 * Kept out of K7Chat.svelte so it is testable under plain `node --test`, the
 * way pager.ts and carousel.ts already are. The component owns only what
 * needs the page: fetches, cross-card events, and state.
 *
 * Prompt templates expand into an ordinary, readable user message that is
 * shown and persisted exactly as sent — the household sees what the model
 * was actually asked, and a thread reopened from the archive still reads
 * sensibly. Nothing is smuggled into a hidden system prompt.
 */
import { ageLabel, describeWeather } from './wmo.ts'

export interface ChatCommand {
  name: string
  aliases: readonly string[]
  /** Argument hint shown in /pomoc and on the chip; absent = takes none. */
  args?: string
  /** Tapping the chip inserts `/name ` for typing instead of running it. */
  argsRequired?: boolean
  summary: string
}

export const COMMANDS: readonly ChatCommand[] = [
  { name: 'clear', aliases: ['nowa', 'wyczysc', 'new'], summary: 'nowa rozmowa; obecna zostaje w archiwum' },
  { name: 'przepis', aliases: ['recipe'], summary: 'ostatnia odpowiedz jako przepis — do przegladu w BAZA.PRZEPISY' },
  { name: 'zakupy', aliases: ['shopping'], summary: 'skladniki z ostatniego przepisu na liste zakupow' },
  { name: 'minutnik', aliases: ['timer'], args: 'czas', argsRequired: true, summary: 'uruchom minutnik: 10, 7:30, 90s, 1h 15min' },
  { name: 'porcje', aliases: ['servings'], args: 'N', argsRequired: true, summary: 'przelicz ostatni przepis na N porcji' },
  { name: 'lodowka', aliases: ['fridge'], args: 'produkty', argsRequired: true, summary: 'co ugotowac z tego, co jest w lodowce' },
  { name: 'pogoda', aliases: ['weather'], args: '[pytanie]', summary: 'wskazowki na dzis na podstawie prognozy' },
  { name: 'context', aliases: ['kontekst'], summary: 'zajetosc okna kontekstu i rezerwa na odpowiedz' },
  { name: 'model', aliases: [], args: '[nazwa]', summary: 'pokaz lub zmien model tej rozmowy' },
  { name: 'koszt', aliases: ['cost'], summary: 'wydatki na AI: dzis i 30 dni' },
  { name: 'tytul', aliases: ['title'], args: 'nazwa', argsRequired: true, summary: 'zmien nazwe rozmowy w archiwum' },
  { name: 'archiwum', aliases: ['historia', 'history'], summary: 'poprzednie rozmowy' },
  { name: 'pomoc', aliases: ['help', '?'], summary: 'ta lista' },
]

/** Lowercase, Polish diacritics folded — `/Lodówka` and `/lodowka` are one command. */
export function foldName(name: string): string {
  return name
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

export function findCommand(name: string): ChatCommand | undefined {
  const folded = foldName(name)
  return COMMANDS.find((c) => c.name === folded || c.aliases.includes(folded))
}

export type ParsedInput =
  | { kind: 'message'; content: string }
  | { kind: 'command'; command: ChatCommand; args: string }
  | { kind: 'unknown'; name: string }

/**
 * `/name args` runs a command; `//text` sends `/text` literally, for the rare
 * message that really does start with a slash.
 */
export function parseInput(raw: string): ParsedInput {
  const text = raw.trim()
  if (text.startsWith('//')) return { kind: 'message', content: text.slice(1) }
  if (!text.startsWith('/')) return { kind: 'message', content: text }
  const match = /^\/(\S*)\s*([\s\S]*)$/.exec(text)
  const name = match?.[1] ?? ''
  const command = findCommand(name)
  if (!command) return { kind: 'unknown', name }
  return { kind: 'command', command, args: (match?.[2] ?? '').trim() }
}

/** Commands whose name or alias starts with what follows the `/` — the chip row's filter. */
export function matchCommands(raw: string): readonly ChatCommand[] {
  const text = raw.trimStart()
  if (!text.startsWith('/') || /\s/.test(text)) return COMMANDS
  const prefix = foldName(text.slice(1))
  if (prefix === '') return COMMANDS
  return COMMANDS.filter((c) => c.name.startsWith(prefix) || c.aliases.some((a) => a.startsWith(prefix)))
}

export function helpText(): string {
  const lines = COMMANDS.map((c) => {
    const head = `/${c.name}${c.args ? ` ${c.args}` : ''}`
    const aliases = c.aliases.length > 0 ? ` (${c.aliases.map((a) => `/${a}`).join(', ')})` : ''
    return `${head.padEnd(20)} ${c.summary}${aliases}`
  })
  return ['> polecenia', ...lines, '//tekst               wyslij wiadomosc zaczynajaca sie od /'].join('\n')
}

// ---------------------------------------------------------------- durations

/** Longest countdown a command will start — a kitchen timer, not a calendar. */
export const MAX_TIMER_SECONDS = 24 * 3600

const UNIT_SECONDS: readonly [RegExp, number][] = [
  [/^(?:h|godz(?:in(?:a|y|e|ę))?\.?)$/, 3600],
  [/^(?:m|min(?:ut(?:a|y|e|ę)?)?\.?)$/, 60],
  [/^(?:s|sek(?:und(?:a|y|e|ę)?)?\.?)$/, 1],
]

function unitSeconds(unit: string): number | undefined {
  const folded = unit.toLowerCase()
  for (const [pattern, seconds] of UNIT_SECONDS) if (pattern.test(folded)) return seconds
  return undefined
}

const toNumber = (s: string): number => Number(s.replace(',', '.'))

/**
 * `10` (minutes), `7:30` (m:ss), `1:05:00` (h:mm:ss), `90s`, `1,5 h`,
 * `1h 15min`, `2 godz 10 min`. Undefined for anything else, zero, or past
 * {@link MAX_TIMER_SECONDS} — a typo must not start a 900-hour timer.
 */
export function parseDuration(raw: string): number | undefined {
  const text = raw.trim().toLowerCase()
  if (text === '') return undefined
  let seconds: number | undefined

  if (/^\d+(?:[.,]\d+)?$/.test(text)) {
    seconds = toNumber(text) * 60
  } else if (/^\d+(?::\d{1,2}){1,2}$/.test(text)) {
    const parts = text.split(':').map(Number)
    if (parts.slice(1).some((p) => p > 59)) return undefined
    seconds = parts.reduce((acc, p) => acc * 60 + p, 0)
    // m:ss by default; h:mm:ss only when three parts are given.
  } else {
    const tokens = [...text.matchAll(/(\d+(?:[.,]\d+)?)\s*([\p{L}.]+)/gu)]
    const consumed = tokens.map((t) => t[0]).join('')
    if (tokens.length === 0 || consumed.replace(/\s/g, '') !== text.replace(/\s/g, '')) return undefined
    seconds = 0
    for (const [, amount, unit] of tokens) {
      const per = unitSeconds(unit ?? '')
      if (per === undefined) return undefined
      seconds += toNumber(amount ?? '0') * per
    }
  }

  const rounded = Math.round(seconds)
  return rounded > 0 && rounded <= MAX_TIMER_SECONDS ? rounded : undefined
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const mmss = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return h > 0 ? `${h}:${mmss}` : mmss
}

/**
 * A number (or `10-12` range) followed by a time unit, in running text.
 * The leading group stands in for a lookbehind — Safari 15 has none.
 * A range starts the timer at its lower bound: checking early is
 * recoverable, overcooking is not.
 */
const DURATION_IN_TEXT =
  /(^|[^\p{L}\p{N}])(\d+(?:[.,]\d+)?)(?:\s*[-–]\s*\d+(?:[.,]\d+)?)?(\s*)(godz(?:in(?:a|y|e|ę))?\.?|h|min(?:ut(?:a|y|e|ę)?)?\.?|sek(?:und(?:a|y|e|ę)?)?\.?|s)(?![\p{L}])/gu

/**
 * Wraps durations in already-rendered chat HTML (lib/markdown.ts output) in
 * `<button class="dur" data-seconds>` so "gotuj 12 minut" is one tap from a
 * running timer. Only text between tags is touched, and never inside
 * `<code>`, `<pre>` or `<a>` — the input is markdown.ts's escaped output,
 * so no text segment can contain a `<` this pass would misread.
 */
export function linkDurations(html: string): string {
  let skipDepth = 0
  return html
    .split(/(<[^>]+>)/)
    .map((part) => {
      if (part.startsWith('<')) {
        const tag = /^<\/?\s*(code|pre|a)\b/i.exec(part)
        if (tag) skipDepth += part.startsWith('</') ? -1 : 1
        return part
      }
      if (skipDepth > 0 || part === '') return part
      return part.replace(DURATION_IN_TEXT, (match, lead: string, amount: string, gap: string, unit: string) => {
        const seconds = parseDuration(`${amount}${gap}${unit}`)
        if (seconds === undefined) return match
        const label = match.slice(lead.length)
        return `${lead}<button type="button" class="dur" data-seconds="${seconds}" aria-label="minutnik ${formatDuration(seconds)}">${label}</button>`
      })
    })
    .join('')
}

// ---------------------------------------------------------------- prompts

function porcji(n: number): string {
  if (n === 1) return 'porcję'
  const mod10 = n % 10
  const mod100 = n % 100
  return mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14) ? 'porcje' : 'porcji'
}

/** Whole servings only, 1–50: `/porcje 0` or `/porcje 1000` is a typo, not a party. */
export function parseServings(raw: string): number | undefined {
  const n = Number(raw.trim())
  return Number.isInteger(n) && n >= 1 && n <= 50 ? n : undefined
}

export function portionsPrompt(servings: number): string {
  return (
    `Przelicz ostatni przepis z tej rozmowy na ${servings} ${porcji(servings)}. ` +
    'Podaj pełną listę składników z nowymi ilościami, zaokrąglonymi do praktycznych miar kuchennych, ' +
    'i zaznacz, jeśli zmienia się czas, temperatura albo wielkość naczynia.'
  )
}

export function fridgePrompt(products: string): string {
  return (
    `Mam w lodówce: ${products.trim()}. Zaproponuj 3 dania, które mogę z tego zrobić — ` +
    'zakładam, że mam też podstawy (sól, pieprz, olej, masło, mąka, cukier, cebula, czosnek). ' +
    'Dla każdego podaj nazwę, czego ewentualnie brakuje i czas przygotowania. ' +
    'Pełny przepis podasz, kiedy wybiorę.'
  )
}

/** The /api/weather payload, as much of it as the prompt reads. */
export interface WeatherSnapshot {
  ageSeconds: number
  stale: boolean
  data: {
    units: { temperature: string; windSpeed: string }
    now: { temperature: number; apparentTemperature: number; humidity: number; windSpeed: number; weatherCode: number }
    daily: { date: string; weatherCode: number; temperatureMax: number; temperatureMin: number }[]
  }
}

const DEFAULT_WEATHER_QUESTION =
  'Daj krótkie, praktyczne wskazówki na dziś: w co się ubrać, czy wywiesić pranie i wietrzyć mieszkanie, ' +
  'oraz co pasowałoby dziś ugotować przy takiej pogodzie.'

/**
 * A readable forecast sentence plus the question — never the raw JSON, which
 * would be noise in the thread and in the archive. Stale data says so, the
 * same rule the weather card itself follows.
 */
export function weatherPrompt(weather: WeatherSnapshot, question: string, locale = 'pl-PL'): string {
  const { units, now, daily } = weather.data
  const t = (n: number): string => `${Math.round(n)}${units.temperature}`
  const day = (iso: string): string =>
    new Date(`${iso}T12:00:00`).toLocaleDateString(locale, { weekday: 'short' }).replace('.', '')
  const upcoming = daily
    .slice(0, 3)
    .map((d) => `${day(d.date)} ${t(d.temperatureMin)}–${t(d.temperatureMax)}, ${describeWeather(d.weatherCode)}`)
    .join('; ')
  const freshness = weather.stale ? ` (uwaga: ostatni odczyt ${ageLabel(weather.ageSeconds)})` : ''
  return (
    `Prognoza dla mojej okolicy${freshness}: teraz ${t(now.temperature)} (odczuwalna ${t(now.apparentTemperature)}), ` +
    `${describeWeather(now.weatherCode)}, wilgotność ${Math.round(now.humidity)}%, ` +
    `wiatr ${Math.round(now.windSpeed)} ${units.windSpeed}. Najbliższe dni: ${upcoming}.\n\n` +
    (question.trim() || DEFAULT_WEATHER_QUESTION)
  )
}

// ---------------------------------------------------------------- /context

/** GET /api/chat/context — see ConversationService's ContextReport. */
export interface ContextReport {
  model: string
  contextLengthKnown: boolean
  contextLength: number
  reservedForResponseTokens: number
  historyBudgetTokens: number
  compactingTriggerTokens: number
  windowTokens: number
  windowMessages: number
  totalMessages: number
  compacted: boolean
}

const BAR_CELLS = 30

/**
 * The whole context window as one bar: `#` used, `-` free history budget,
 * `|` where compacting starts, `.` the slice reserved for the reply.
 */
export function contextBar(r: ContextReport, cells = BAR_CELLS): string {
  const at = (tokens: number): number => Math.min(cells, Math.round((tokens / r.contextLength) * cells))
  const used = r.windowTokens > 0 ? Math.max(1, at(r.windowTokens)) : 0
  const budgetEnd = at(r.historyBudgetTokens)
  const trigger = Math.min(at(r.compactingTriggerTokens), cells - 1)
  let bar = ''
  for (let i = 0; i < cells; i += 1) {
    if (i < used) bar += '#'
    else if (i === trigger) bar += '|'
    else if (i >= budgetEnd) bar += '.'
    else bar += '-'
  }
  return `[${bar}]`
}

export function formatContextReport(r: ContextReport, locale = 'pl-PL'): string {
  const n = (v: number): string => v.toLocaleString(locale)
  const pct = (part: number, whole: number): string => `${whole > 0 ? Math.round((part / whole) * 100) : 0}%`
  const window =
    r.totalMessages === 0
      ? 'okno: puste (nowa rozmowa)'
      : `okno: ~${n(r.windowTokens)} tok. // ${r.windowMessages} z ${r.totalMessages} wiad.` +
        (r.compacted ? ' // od streszczenia' : '')
  return [
    `> kontekst // ${r.model}`,
    `${contextBar(r)} ${pct(r.windowTokens, r.historyBudgetTokens)} budzetu historii`,
    window,
    `okno modelu: ${n(r.contextLength)} tok.${r.contextLengthKnown ? '' : ' (zalozone — brak w katalogu)'}`,
    `rezerwa na odpowiedz: ${n(r.reservedForResponseTokens)} tok. (${pct(r.reservedForResponseTokens, r.contextLength)})`,
    `kompaktowanie od: ~${n(r.compactingTriggerTokens)} tok. (${pct(r.compactingTriggerTokens, r.historyBudgetTokens)} budzetu)`,
    '# uzyte  - wolne  | kompaktowanie  . rezerwa',
  ].join('\n')
}

/** Short enough for an archive row; the server caps it too. */
export function titleFrom(text: string, max = 60): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length > max ? `${oneLine.slice(0, max - 1).trimEnd()}…` : oneLine
}
