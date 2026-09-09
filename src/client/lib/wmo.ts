/**
 * WMO weather codes → Polish labels.
 *
 * Open-Meteo returns a bare integer and nothing else, so this table is the only
 * thing standing between the card and a number nobody can read. Taken from the
 * documented code list, not from memory — the sparse numbering (0–3, then 45,
 * 48, then 51–57…) is what it actually is, and the gaps are real.
 *
 * Labels are lowercase because the design's voice puts data in lowercase and
 * reserves uppercase for HUD labels.
 */
export const WMO: Readonly<Record<number, string>> = {
  0: 'bezchmurnie',
  1: 'przewaznie bezchmurnie',
  2: 'czesciowe zachmurzenie',
  3: 'zachmurzenie calkowite',
  45: 'mgla',
  48: 'mgla osadzajaca szron',
  51: 'mzawka slaba',
  53: 'mzawka umiarkowana',
  55: 'mzawka gesta',
  56: 'mzawka marznaca slaba',
  57: 'mzawka marznaca gesta',
  61: 'deszcz slaby',
  63: 'deszcz umiarkowany',
  65: 'deszcz silny',
  66: 'deszcz marznacy slaby',
  67: 'deszcz marznacy silny',
  71: 'snieg slaby',
  73: 'snieg umiarkowany',
  75: 'snieg intensywny',
  77: 'krupy sniezne',
  80: 'przelotny deszcz slaby',
  81: 'przelotny deszcz umiarkowany',
  82: 'przelotny deszcz gwaltowny',
  85: 'przelotny snieg slaby',
  86: 'przelotny snieg intensywny',
  95: 'burza',
  96: 'burza z gradem',
  99: 'burza z silnym gradem',
}

/** Unknown codes are reported as unknown rather than guessed at. */
export function describeWeather(code: number): string {
  return WMO[code] ?? `kod ${code}`
}

/** Codes worth flagging on a kitchen wall — the ones that change plans. */
const SEVERE = new Set([56, 57, 65, 66, 67, 75, 82, 86, 95, 96, 99])

export function isSevere(code: number): boolean {
  return SEVERE.has(code)
}

/**
 * How old is too old to present without comment.
 *
 * The backend already says whether it considers a response stale; this is the
 * card's own, stricter view for the glance tier, because a temperature read from
 * the doorway is taken as current whether or not it says otherwise.
 */
export function ageLabel(ageSeconds: number): string {
  if (ageSeconds < 90) return 'teraz'
  const minutes = Math.round(ageSeconds / 60)
  if (minutes < 60) return `${minutes} min temu`
  const hours = Math.round(minutes / 60)
  return hours < 24 ? `${hours} godz. temu` : `${Math.round(hours / 24)} dni temu`
}
