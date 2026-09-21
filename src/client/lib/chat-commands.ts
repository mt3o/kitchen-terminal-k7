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
import { CALENDAR_FUTURE_DAYS } from './calendar.ts'
import { ageLabel, describeWeather } from './wmo.ts'

export interface ChatCommand {
  name: string
  aliases: readonly string[]
  /** Argument hint shown in /pomoc and on the chip; absent = takes none. */
  args?: string
  /** Tapping the chip inserts `/name ` for typing instead of running it. */
  argsRequired?: boolean
  /** One line: the chip's tooltip and the wizard's button subtitle. */
  summary: string
  /** Which wizard section it belongs to. */
  group: CommandGroupId
  /**
   * What running it actually does, for the wizard's second step — including
   * what it will NOT do (nothing is saved, a running timer is not replaced).
   * Two sentences at most: it is read standing up, in a kitchen.
   */
  details: string
}

export type CommandGroupId = 'gotowanie' | 'rozmowa' | 'system'

export interface CommandGroup {
  id: CommandGroupId
  label: string
}

/** Wizard sections, in the order the first step shows them. */
export const COMMAND_GROUPS: readonly CommandGroup[] = [
  { id: 'gotowanie', label: 'GOTOWANIE' },
  { id: 'rozmowa', label: 'ROZMOWA' },
  { id: 'system', label: 'SYSTEM' },
]

export const COMMANDS: readonly ChatCommand[] = [
  {
    name: 'menu',
    aliases: ['gui'],
    group: 'system',
    summary: 'polecenia krok po kroku, bez pisania ukosnika',
    details: 'Otwiera te liste. Wybierasz polecenie, potem wypelniasz jego pola — skladnia nie jest do niczego potrzebna.',
  },
  {
    name: 'przepis',
    aliases: ['recipe'],
    group: 'gotowanie',
    summary: 'ostatnia odpowiedz jako przepis',
    details:
      'Bierze ostatnia odpowiedz AI i otwiera ja jako przepis do przegladu w karcie BAZA.PRZEPISY. ' +
      'Nic nie zapisuje sie samo — zapisujesz tam przyciskiem ZAPISZ.',
  },
  {
    name: 'zakupy',
    aliases: ['shopping'],
    group: 'gotowanie',
    summary: 'skladniki z przepisu na liste zakupow',
    details:
      'Wyciaga skladniki z ostatniego przepisu w rozmowie i pokazuje je do odznaczenia. ' +
      'To, co juz jest na liscie, zaznacza jako posiadane; reszta trafia na LISTA.ZAKUPY dopiero po DODAJ.',
  },
  {
    name: 'minutnik',
    aliases: ['timer'],
    group: 'gotowanie',
    args: 'czas',
    argsRequired: true,
    summary: 'uruchom minutnik',
    details: 'Uruchamia karte MINUTNIK. Odliczania, ktore juz trwa, nie przerwie — najpierw je zatrzymaj.',
  },
  {
    name: 'porcje',
    aliases: ['servings'],
    group: 'gotowanie',
    args: 'N',
    argsRequired: true,
    summary: 'przelicz przepis na inna liczbe porcji',
    details: 'Prosi AI o przeliczenie ostatniego przepisu z rozmowy: nowe ilosci skladnikow i to, co zmienia sie w czasie albo naczyniu.',
  },
  {
    name: 'lodowka',
    aliases: ['fridge'],
    group: 'gotowanie',
    args: 'produkty',
    argsRequired: true,
    summary: 'co ugotowac z tego, co masz',
    details: 'Podajesz, co masz pod reka; AI proponuje 3 dania, mowi czego brakuje i ile zajmie. Podstawy (sol, olej, maka) zaklada sam.',
  },
  {
    name: 'plan',
    aliases: ['jadlospis'],
    group: 'gotowanie',
    args: '[dni]',
    summary: 'jadlospis z kalendarza, pogody i bazy przepisow',
    details:
      'Zbiera wydarzenia z kalendarza na ten tydzien, prognoze i tytuly z Twojej bazy przepisow, potem prosi o jadlospis. ' +
      'W dni z wydarzeniami po 15:00 proponuje dania do 30 minut.',
  },
  {
    name: 'zamiennik',
    aliases: ['zamien', 'substitute'],
    group: 'gotowanie',
    args: 'skladnik',
    argsRequired: true,
    summary: 'czym zastapic skladnik',
    details: 'Pyta o 2-3 zamienniki z proporcjami i o to, jak zmieni sie smak albo konsystencja. Uwzglednia przepis z tej rozmowy.',
  },
  {
    name: 'przelicz',
    aliases: ['convert'],
    group: 'gotowanie',
    args: 'ilosc',
    argsRequired: true,
    summary: 'szklanki i lyzki na gramy, i odwrotnie',
    details:
      'Liczy od razu z tabeli miar kuchennych, bez pytania AI (szklanka 250 ml, lyzka 15 ml, lyzeczka 5 ml). ' +
      'Podaje, jaka gestosc przyjal. Skladnik spoza tabeli przelicza AI.',
  },
  {
    name: 'pogoda',
    aliases: ['weather'],
    group: 'gotowanie',
    args: '[pytanie]',
    summary: 'wskazowki na dzis z prognozy',
    details: 'Bierze prognoze dla lokalizacji z karty pogody i prosi o praktyczne wskazowki: ubranie, pranie, wietrzenie i co ugotowac.',
  },
  {
    name: 'clear',
    aliases: ['nowa', 'wyczysc', 'new'],
    group: 'rozmowa',
    summary: 'zacznij nowa rozmowe',
    details: 'Zaczyna rozmowe od zera. Obecna nie znika — zostaje w archiwum i mozesz do niej wrocic.',
  },
  {
    name: 'ponow',
    aliases: ['retry'],
    group: 'rozmowa',
    args: '[model]',
    summary: 'to samo pytanie jeszcze raz',
    details: 'Wysyla ostatnie pytanie ponownie, bez przepisywania go. Mozesz przy okazji zapytac inny model.',
  },
  {
    name: 'model',
    aliases: [],
    group: 'rozmowa',
    args: '[nazwa]',
    summary: 'zmien model tej rozmowy',
    details: 'Kontekst rozmowy zostaje — kolejne odpowiedzi pisze wybrany model. Bez podanej nazwy wypisuje dostepne modele.',
  },
  {
    name: 'tytul',
    aliases: ['title'],
    group: 'rozmowa',
    args: 'nazwa',
    argsRequired: true,
    summary: 'nazwij te rozmowe',
    details: 'Nazwa, pod ktora rozmowa bedzie widoczna w archiwum. Bez niej archiwum pokazuje pierwsza wiadomosc.',
  },
  {
    name: 'archiwum',
    aliases: ['historia', 'history'],
    group: 'rozmowa',
    summary: 'poprzednie rozmowy',
    details: 'Lista zapisanych rozmow — mozesz je otworzyc, przemianowac albo usunac.',
  },
  {
    name: 'context',
    aliases: ['kontekst'],
    group: 'system',
    summary: 'ile okna kontekstu zajmuje rozmowa',
    details: 'Pokazuje zajetosc okna modelu, rezerwe na odpowiedz i prog, od ktorego historia jest streszczana.',
  },
  {
    name: 'koszt',
    aliases: ['cost'],
    group: 'system',
    summary: 'wydatki na AI',
    details: 'Szacunek z cennika bramki: dzis i przez ostatnie 30 dni, razem z liczba wywolan.',
  },
  {
    name: 'pomoc',
    aliases: ['help', '?'],
    group: 'system',
    summary: 'lista polecen w oknie rozmowy',
    details: 'Wypisuje wszystkie polecenia z ich skladnia, do szybkiego podejrzenia bez otwierania tej listy.',
  },
]

/** The wizard's first step: commands of one group, in declaration order. */
export function commandsInGroup(group: CommandGroupId): readonly ChatCommand[] {
  return COMMANDS.filter((c) => c.group === group)
}

/** Exactly what would have been typed — shown in the wizard so the syntax is learnable. */
export function previewCommand(command: ChatCommand, args: string): string {
  const trimmed = args.trim()
  return trimmed ? `/${command.name} ${trimmed}` : `/${command.name}`
}

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

// ------------------------------------------------------- kitchen measures

/**
 * `/przelicz` answers from a table first and only asks the model when the
 * table has nothing — the same exact-then-heuristic shape recipe import uses
 * (JSON-LD, then Readability). A cup of flour is a fixed, checkable number;
 * spending a gateway call and three seconds on it while someone stands over
 * a bowl is the wrong trade.
 *
 * Densities are g per 100 ml, for the ingredient as a household actually
 * scoops it (flour spooned, not packed). They are approximations and every
 * answer says so with `≈` — kitchen measures vary by more than the rounding.
 */
const KITCHEN_VOLUME_ML: readonly [RegExp, number][] = [
  [/^lyzecz(?:ka|ki|ek|kach)$/, 5],
  [/^(?:lyz(?:ka|ki|ek)|lyzk\.?)$/, 15],
  [/^szkl(?:\.|anka|anki|ance|anke|anek)?$/, 250],
  [/^(?:ml|mililitr(?:y|ow)?)$/, 1],
  [/^(?:l|litr(?:y|ow|a)?)$/, 1000],
]

const KITCHEN_WEIGHT_G: readonly [RegExp, number][] = [
  [/^(?:g|gr|gram(?:y|ow|a)?)$/, 1],
  [/^(?:dag|deka(?:gram(?:y|ow|a)?)?)$/, 10],
  [/^(?:kg|kilogram(?:y|ow|a)?)$/, 1000],
]

interface Density {
  /** How the answer names it, in the nominative. */
  label: string
  /** Word stems, each of which must match a word of the input — see {@link matchesStem}. */
  stems: readonly string[]
  gPer100ml: number
}

/**
 * A stem matches a word when the word begins with it and adds no more than
 * an inflected ending. How much ending is allowed depends on the stem's
 * length, and that is the whole trick: a short stem like `mak` may grow by
 * two letters (`mąki`, `mąka`) but not four, or it would swallow `makaron`;
 * a long one like `ziemniacza` needs four (`ziemniaczanej`) and is specific
 * enough to afford them.
 */
function matchesStem(word: string, stem: string): boolean {
  if (!word.startsWith(stem)) return false
  return word.length - stem.length <= (stem.length <= 4 ? 2 : 4)
}

const DENSITIES: readonly Density[] = [
  { label: 'mąka ziemniaczana', stems: ['mak', 'ziemniacza'], gPer100ml: 65 },
  { label: 'mąka żytnia', stems: ['mak', 'zytni'], gPer100ml: 55 },
  // Plain "mąka" is wheat flour in a Polish kitchen; the label says so rather
  // than leaving the household to guess which flour the number assumed.
  { label: 'mąka pszenna', stems: ['mak', 'pszenn'], gPer100ml: 60 },
  { label: 'mąka pszenna', stems: ['mak'], gPer100ml: 60 },
  { label: 'cukier puder', stems: ['cukr', 'pudr'], gPer100ml: 50 },
  { label: 'cukier puder', stems: ['cukier', 'puder'], gPer100ml: 50 },
  { label: 'cukier', stems: ['cuki'], gPer100ml: 85 },
  { label: 'cukier', stems: ['cukr'], gPer100ml: 85 },
  { label: 'sól', stems: ['sol'], gPer100ml: 120 },
  { label: 'ryż', stems: ['ryz'], gPer100ml: 90 },
  { label: 'kasza manna', stems: ['kasz', 'mann'], gPer100ml: 70 },
  { label: 'kasza', stems: ['kasz'], gPer100ml: 85 },
  { label: 'płatki owsiane', stems: ['platk'], gPer100ml: 40 },
  { label: 'bułka tarta', stems: ['bulk', 'tart'], gPer100ml: 45 },
  { label: 'kakao', stems: ['kakao'], gPer100ml: 45 },
  { label: 'mleko', stems: ['mlek'], gPer100ml: 103 },
  { label: 'śmietana', stems: ['smietan'], gPer100ml: 100 },
  { label: 'jogurt', stems: ['jogurt'], gPer100ml: 105 },
  { label: 'woda', stems: ['wod'], gPer100ml: 100 },
  { label: 'olej', stems: ['olej'], gPer100ml: 92 },
  { label: 'oliwa', stems: ['oliw'], gPer100ml: 92 },
  { label: 'masło', stems: ['masl'], gPer100ml: 95 },
  { label: 'miód', stems: ['miod'], gPer100ml: 140 },
  { label: 'rodzynki', stems: ['rodzynk'], gPer100ml: 65 },
  { label: 'soczewica', stems: ['soczewic'], gPer100ml: 85 },
  { label: 'orzechy', stems: ['orzech'], gPer100ml: 50 },
  { label: 'ser żółty starty', stems: ['ser', 'start'], gPer100ml: 40 },
  { label: 'proszek do pieczenia', stems: ['proszk'], gPer100ml: 90 },
  { label: 'proszek do pieczenia', stems: ['proszek'], gPer100ml: 90 },
]

/** Units the /menu form offers, in the order a kitchen reaches for them. */
export const MEASURE_UNITS: readonly string[] = ['szklanka', 'łyżka', 'łyżeczka', 'ml', 'l', 'g', 'dag', 'kg']

const WORD_FRACTIONS: Record<string, number> = { pol: 0.5, cwierc: 0.25 }
const GLYPH_FRACTIONS: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3 }

function parseAmount(raw: string): number | undefined {
  const text = raw.trim()
  if (text === '') return undefined
  const glyph = GLYPH_FRACTIONS[text]
  if (glyph !== undefined) return glyph
  const folded = foldName(text)
  if (WORD_FRACTIONS[folded] !== undefined) return WORD_FRACTIONS[folded]
  // "1 1/2", "1/2", "1½"
  const mixed = /^(\d+)?\s*(?:(\d+)\/(\d+)|([½¼¾⅓⅔]))$/.exec(text)
  if (mixed) {
    const whole = mixed[1] ? Number(mixed[1]) : 0
    const fraction = mixed[4] ? (GLYPH_FRACTIONS[mixed[4]] ?? 0) : Number(mixed[2]) / Number(mixed[3])
    return Number.isFinite(fraction) && fraction > 0 ? whole + fraction : undefined
  }
  const plain = Number(text.replace(',', '.'))
  return Number.isFinite(plain) && plain > 0 ? plain : undefined
}

export interface Measure {
  amount: number
  /** Millilitres per unit, or undefined for a weight unit. */
  ml?: number
  /** Grams per unit, or undefined for a volume unit. */
  g?: number
  unitLabel: string
  ingredient: string
}

/** `2 szklanki mąki`, `1,5 łyżki`, `pół szklanki mleka`, `300g mąki`, `30 dag ryżu`. */
export function parseMeasure(raw: string): Measure | undefined {
  const text = raw.trim().replace(/\s+/g, ' ')
  const match = /^([\d.,/½¼¾⅓⅔ ]+|pół|pol|ćwierć|cwierc)\s*([\p{L}.]+)\s*(.*)$/u.exec(text)
  if (!match) return undefined
  const amount = parseAmount(match[1] ?? '')
  if (amount === undefined) return undefined
  const unitWord = foldName(match[2] ?? '')
  const ingredient = (match[3] ?? '').trim()
  for (const [pattern, ml] of KITCHEN_VOLUME_ML) {
    if (pattern.test(unitWord)) return { amount, ml, unitLabel: match[2] ?? '', ingredient }
  }
  for (const [pattern, g] of KITCHEN_WEIGHT_G) {
    if (pattern.test(unitWord)) return { amount, g, unitLabel: match[2] ?? '', ingredient }
  }
  return undefined
}

function findDensity(ingredient: string): Density | undefined {
  const words = foldName(ingredient).split(/[^a-z0-9]+/).filter(Boolean)
  if (words.length === 0) return undefined
  return DENSITIES.find((d) => d.stems.every((stem) => words.some((w) => matchesStem(w, stem))))
}

/** Coarse where coarse is honest: nobody weighs 287 g of flour. */
function roundKitchen(value: number): number {
  if (value < 20) return Math.round(value * 10) / 10
  if (value < 100) return Math.round(value)
  return Math.round(value / 5) * 5
}

function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one
  if (!Number.isInteger(n)) return few
  const mod10 = n % 10
  const mod100 = n % 100
  return mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14) ? few : many
}

const number = (n: number): string => String(Math.round(n * 100) / 100).replace('.', ',')

/** Volume expressed the way a recipe would ask for it. */
function inKitchenUnits(ml: number): string {
  if (ml >= 190) {
    const cups = Math.round((ml / 250) * 4) / 4
    return `${number(cups)} ${plural(cups, 'szklanka', 'szklanki', 'szklanek')}`
  }
  if (ml >= 12) {
    const spoons = Math.round(ml / 15)
    return `${spoons} ${plural(spoons, 'łyżka', 'łyżki', 'łyżek')}`
  }
  const teaspoons = Math.round((ml / 5) * 2) / 2
  return `${number(teaspoons)} ${plural(teaspoons, 'łyżeczka', 'łyżeczki', 'łyżeczek')}`
}

/**
 * The local answer, or undefined when the table cannot honestly produce one
 * (an unknown ingredient, an unknown unit) — then the caller asks the model.
 */
export function convertMeasure(raw: string): string | undefined {
  const measure = parseMeasure(raw)
  if (!measure) return undefined
  const density = measure.ingredient ? findDensity(measure.ingredient) : undefined
  const what = measure.ingredient ? ` ${measure.ingredient}` : ''

  if (measure.ml !== undefined) {
    const ml = measure.amount * measure.ml
    if (!density) {
      // Pure volume is exact and needs no ingredient at all.
      if (measure.ingredient) return undefined
      return `> ${number(measure.amount)} ${measure.unitLabel} = ${number(roundKitchen(ml))} ml`
    }
    const grams = (ml * density.gPer100ml) / 100
    return [
      `> ${number(measure.amount)} ${measure.unitLabel}${what} ≈ ${number(roundKitchen(grams))} g`,
      `${number(roundKitchen(ml))} ml // ${density.label} ≈ ${density.gPer100ml} g/100 ml`,
    ].join('\n')
  }

  const grams = measure.amount * (measure.g ?? 1)
  if (!density) {
    if (measure.ingredient || measure.g === 1) return undefined
    return `> ${number(measure.amount)} ${measure.unitLabel} = ${number(roundKitchen(grams))} g`
  }
  const ml = (grams * 100) / density.gPer100ml
  return [
    `> ${number(measure.amount)} ${measure.unitLabel}${what} ≈ ${inKitchenUnits(ml)}`,
    `${number(roundKitchen(ml))} ml // ${density.label} ≈ ${density.gPer100ml} g/100 ml`,
  ].join('\n')
}

export function convertPrompt(text: string): string {
  return (
    `Przelicz na miary kuchenne: ${text.trim()}. ` +
    'Podaj wynik w gramach lub mililitrach jako jedną liczbę, krótko, jednym zdaniem, ' +
    'i zaznacz, że to przybliżenie, jeśli zależy od tego, jak składnik jest sypany.'
  )
}

// --------------------------------------------------------- more templates

export function substitutePrompt(ingredient: string): string {
  return (
    `Czym mogę zastąpić: ${ingredient.trim()}? Podaj 2-3 zamienniki z proporcjami ` +
    '(ile czego zamiast ile czego) i jednym zdaniem, jak zmieni się smak albo konsystencja. ' +
    'Jeśli w tej rozmowie jest przepis, weź go pod uwagę.'
  )
}

/** One day of the plan's calendar section. */
export interface PlanDay {
  date: Date
  entries: string[]
}

export interface PlanEvent {
  title: string
  /** ISO 8601 — a timestamp, or a bare YYYY-MM-DD for an all-day entry. */
  start: string
  allDay?: boolean
}

const dayKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/**
 * Events bucketed into the next `days` local days. All-day entries are
 * labelled rather than given a made-up time, and an event's own date is read
 * in local time — the calendar card shows the same week the household does.
 */
export function planDays(from: Date, days: number, events: readonly PlanEvent[]): PlanDay[] {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  return Array.from({ length: days }, (_, i) => {
    const date = new Date(start)
    date.setDate(start.getDate() + i)
    const key = dayKey(date)
    const entries = events
      .filter((e) => {
        const isAllDay = e.allDay || !e.start.includes('T')
        const eventDate = isAllDay ? e.start.slice(0, 10) : dayKey(new Date(e.start))
        return eventDate === key
      })
      .map((e) => {
        const isAllDay = e.allDay || !e.start.includes('T')
        if (isAllDay) return `całodzienne: ${e.title}`
        const at = new Date(e.start)
        return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')} ${e.title}`
      })
    return { date, entries }
  })
}

/**
 * The first day the calendar cannot answer for: the day after the last one
 * `/api/calendar/week` fetches (today + `CALENDAR_FUTURE_DAYS`), so a plan
 * that somehow runs past it says those days are unknown rather than free.
 */
export function calendarDataEnd(now: Date): Date {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  end.setDate(end.getDate() + CALENDAR_FUTURE_DAYS + 1)
  return end
}

export function parsePlanDays(raw: string, fallback = 7): number {
  const n = Number(raw.trim())
  return Number.isInteger(n) && n >= 1 && n <= 14 ? n : fallback
}

export interface PlanInput {
  days: PlanDay[]
  /** Titles from the household's own recipe base; empty when there are none. */
  recipes: readonly string[]
  weather?: WeatherSnapshot
  /** True when the calendar could not be read — say nothing rather than imply a free week. */
  calendarUnavailable?: boolean
  /**
   * First day the calendar data does NOT cover. A plan that runs past it must
   * say those days are unknown — an empty day and an unseen day are different
   * claims.
   */
  calendarUntil?: Date
}

/**
 * The meal-plan prompt. Every section is omitted when its data is missing
 * rather than filled with a guess: an empty calendar section would read as
 * "nothing on all week", which is a different claim from "I could not look".
 */
export function planPrompt(input: PlanInput, locale = 'pl-PL'): string {
  const dayLabel = new Intl.DateTimeFormat(locale, { weekday: 'short', day: '2-digit', month: '2-digit' })
  const lines: string[] = [
    `Zaplanuj obiady na ${input.days.length} ${plural(input.days.length, 'dzień', 'dni', 'dni')} dla mojego domu.`,
  ]

  if (!input.calendarUnavailable) {
    lines.push('', 'Kalendarz:')
    for (const day of input.days) {
      const label = dayLabel.format(day.date).replace('., ', ' ')
      const unknown = input.calendarUntil !== undefined && day.date.getTime() >= input.calendarUntil.getTime()
      const entries = unknown ? 'brak danych z kalendarza' : day.entries.length > 0 ? day.entries.join('; ') : 'nic zaplanowanego'
      lines.push(`- ${label}: ${entries}`)
    }
  }

  if (input.recipes.length > 0) {
    lines.push('', `Przepisy w mojej bazie: ${input.recipes.join('; ')}.`)
  }

  if (input.weather) {
    const { units, daily } = input.weather.data
    const t = (n: number): string => `${Math.round(n)}${units.temperature}`
    const forecast = daily
      .slice(0, input.days.length)
      .map(
        (d) =>
          `${dayLabel.format(new Date(`${d.date}T12:00:00`)).replace('., ', ' ')} ` +
          `${t(d.temperatureMin)}–${t(d.temperatureMax)}, ${describeWeather(d.weatherCode)}`,
      )
      .join('; ')
    if (forecast) lines.push('', `Pogoda: ${forecast}.`)
  }

  lines.push(
    '',
    'Dla każdego dnia podaj: dzień, danie, czas przygotowania i jedno zdanie uzasadnienia. ' +
      'W dni z wydarzeniami po 15:00 proponuj dania do 30 minut. ' +
      (input.recipes.length > 0 ? 'Najpierw sięgaj po przepisy z mojej bazy, nowe dania dodawaj tylko jako uzupełnienie. ' : '') +
      'Na końcu dopisz zbiorczą listę zakupów na cały plan.',
  )
  return lines.join('\n')
}

// ------------------------------------------------------------- /menu forms

export type FormFieldKind = 'text' | 'number' | 'select'

/** Where the card fills a field's quick-pick chips or select options from live state. */
export type FormSuggestions = 'models' | 'ingredients' | 'timerPresets' | 'servings' | 'title'

export interface FormField {
  name: string
  label: string
  kind: FormFieldKind
  /** One line under the field: what to put in it, or what leaving it empty means. */
  help?: string
  placeholder?: string
  min?: number
  max?: number
  initial?: string
  optional?: boolean
  options?: readonly { value: string; label: string }[]
  suggest?: FormSuggestions
}

export interface CommandForm {
  /** Command name this form runs. */
  command: string
  /** One line above the fields, in the card's voice. */
  intro: string
  fields: readonly FormField[]
  /** Field values → the command's argument string. */
  build: (values: Record<string, string>) => string
}

const value = (values: Record<string, string>, name: string): string => (values[name] ?? '').trim()

/**
 * The /menu forms: a command that takes arguments gets labelled fields and
 * quick picks instead of remembered syntax. This is the wall-display path —
 * nobody hunts for `/` on an on-screen keyboard while cooking.
 *
 * Only commands whose arguments a form actually helps with are listed; the
 * rest run straight from the menu with no form at all.
 */
export const COMMAND_FORMS: readonly CommandForm[] = [
  {
    command: 'minutnik',
    intro: 'ile ma odliczyc minutnik',
    fields: [
      {
        name: 'czas',
        label: 'czas',
        kind: 'text',
        placeholder: '10, 7:30, 1h 15min',
        help: 'sama liczba to minuty; mozna tez 7:30, 90s albo 1h 15min',
        suggest: 'timerPresets',
      },
    ],
    build: (v) => value(v, 'czas'),
  },
  {
    command: 'porcje',
    intro: 'na ile porcji przeliczyc ostatni przepis',
    fields: [
      {
        name: 'porcje',
        label: 'porcje',
        kind: 'number',
        min: 1,
        max: 50,
        initial: '4',
        help: 'na ile osob ma wystarczyc ostatni przepis z rozmowy',
        suggest: 'servings',
      },
    ],
    build: (v) => value(v, 'porcje'),
  },
  {
    command: 'lodowka',
    intro: 'co masz pod reka',
    fields: [
      {
        name: 'produkty',
        label: 'produkty',
        kind: 'text',
        placeholder: 'jajka, szpinak, feta',
        help: 'po przecinku; podstaw (sol, olej, maka, cebula) nie musisz wypisywac',
      },
    ],
    build: (v) => value(v, 'produkty'),
  },
  {
    command: 'przelicz',
    intro: 'miara kuchenna na gramy — i odwrotnie',
    fields: [
      { name: 'ilosc', label: 'ilosc', kind: 'text', initial: '1', placeholder: '1, 1,5, 1/2', help: 'liczba, ulamek albo polowa' },
      {
        name: 'jednostka',
        label: 'jednostka',
        kind: 'select',
        initial: 'szklanka',
        help: 'z czego przeliczamy',
        options: MEASURE_UNITS.map((u) => ({ value: u, label: u })),
      },
      {
        name: 'skladnik',
        label: 'skladnik',
        kind: 'text',
        optional: true,
        placeholder: 'maki pszennej',
        help: 'bez niego przeliczy sama objetosc albo wage',
        suggest: 'ingredients',
      },
    ],
    build: (v) => [value(v, 'ilosc'), value(v, 'jednostka'), value(v, 'skladnik')].filter(Boolean).join(' '),
  },
  {
    command: 'zamiennik',
    intro: 'czego brakuje',
    fields: [
      {
        name: 'skladnik',
        label: 'skladnik',
        kind: 'text',
        placeholder: 'maslo',
        help: 'czego brakuje albo czego chcesz uniknac',
        suggest: 'ingredients',
      },
    ],
    build: (v) => value(v, 'skladnik'),
  },
  {
    command: 'plan',
    intro: 'jadlospis z kalendarza, pogody i twojej bazy przepisow',
    fields: [
      {
        name: 'dni',
        label: 'na ile dni',
        kind: 'select',
        initial: '7',
        help: 'kalendarz znamy do konca tego tygodnia — dalsze dni AI planuje bez niego',
        options: [3, 5, 7, 10, 14].map((d) => ({ value: String(d), label: `${d} dni` })),
      },
    ],
    build: (v) => value(v, 'dni'),
  },
  {
    command: 'pogoda',
    intro: 'wskazowki na dzis; pytanie mozesz zostawic puste',
    fields: [
      {
        name: 'pytanie',
        label: 'pytanie',
        kind: 'text',
        optional: true,
        placeholder: 'czy grillowac?',
        help: 'puste pole = wskazowki na dzis: ubranie, pranie, wietrzenie, obiad',
      },
    ],
    build: (v) => value(v, 'pytanie'),
  },
  {
    command: 'ponow',
    intro: 'zapytaj jeszcze raz; mozesz wybrac inny model',
    fields: [
      { name: 'model', label: 'model', kind: 'select', optional: true, help: 'bez zmiany pyta ten sam model', suggest: 'models' },
    ],
    build: (v) => value(v, 'model'),
  },
  {
    command: 'model',
    intro: 'model tej rozmowy',
    fields: [{ name: 'model', label: 'model', kind: 'select', help: 'lista z bramki Kilo', suggest: 'models' }],
    build: (v) => value(v, 'model'),
  },
  {
    command: 'tytul',
    intro: 'nazwa rozmowy w archiwum',
    fields: [{ name: 'tytul', label: 'tytul', kind: 'text', help: 'krotka nazwa widoczna w archiwum', suggest: 'title' }],
    build: (v) => value(v, 'tytul'),
  },
]

export function formFor(command: string): CommandForm | undefined {
  return COMMAND_FORMS.find((f) => f.command === command)
}

/** Every field a form needs before it can run — a required field left empty. */
export function missingFields(form: CommandForm, values: Record<string, string>): readonly FormField[] {
  return form.fields.filter((f) => !f.optional && value(values, f.name) === '')
}

export function initialFormValues(form: CommandForm): Record<string, string> {
  const values: Record<string, string> = {}
  for (const field of form.fields) values[field.name] = field.initial ?? ''
  return values
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
