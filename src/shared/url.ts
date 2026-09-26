/**
 * Scheme-only guard for a URL that will become a clickable `href` — a comic
 * feed's own `<link>` content, a recipe's editable source. Deliberately not
 * `isFetchableUrl` (`src/server/security/network.ts`): that guard also
 * rejects private/loopback hosts, which is correct when the *server* is
 * about to fetch the URL (SSRF) but wrong here, where the URL is only ever
 * navigated by the household's own browser — a private-LAN link is a
 * legitimate thing to click, a `javascript:`/`data:` scheme is not.
 */
export function isHttpUrl(value: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}
