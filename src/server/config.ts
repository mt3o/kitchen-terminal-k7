/**
 * Server configuration, read once at boot.
 *
 * `.env.schema` is the committed source of truth for shape and sensitivity;
 * real values come from a git-ignored `.env.local` or a secret provider, via
 * Varlock. This module is the only place that reads `process.env`, so there is
 * exactly one list of which values are secret — and {@link secretValues} is what
 * the scrubber is built from. Two lists would drift and the second one would be
 * the one nobody updated.
 */

export interface Config {
  port: number
  host: string
  environment: string
  /** SQLite file. `:memory:` is honoured, which is how the tests run. */
  databasePath: string
  /** Absent means error reporting is off. That is a supported way to run. */
  glitchtipDsn: string | undefined
  kiloGatewayKey: string | undefined
  googleOauthRefreshToken: string | undefined
}

function readPort(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  // Failing loudly at boot beats binding to port 0 and looking healthy.
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`K7_PORT must be an integer between 1 and 65535, got ${JSON.stringify(raw)}`)
  }
  return n
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: readPort(env.K7_PORT, 8080),
    host: env.K7_HOST ?? '0.0.0.0',
    environment: env.NODE_ENV ?? 'development',
    databasePath: env.K7_DB_PATH ?? './data/k7.sqlite',
    glitchtipDsn: env.GLITCHTIP_DSN || undefined,
    kiloGatewayKey: env.KILO_GATEWAY_KEY || undefined,
    googleOauthRefreshToken: env.GOOGLE_OAUTH_REFRESH_TOKEN || undefined,
  }
}

/**
 * Every secret value this process holds, for the scrubber to match against.
 * The DSN is included deliberately: it carries its own key, and a DSN echoed
 * into a log line is a working credential for someone else's project.
 */
export function secretValues(config: Config): readonly (string | undefined)[] {
  return [config.kiloGatewayKey, config.googleOauthRefreshToken, config.glitchtipDsn]
}

/** A one-line boot summary that is safe to print. Never include a value here. */
export function describeConfig(config: Config): string {
  const present = (v: string | undefined): string => (v ? 'set' : 'unset')
  return [
    `env=${config.environment}`,
    `host=${config.host}`,
    `port=${config.port}`,
    `db=${config.databasePath}`,
    `glitchtip=${present(config.glitchtipDsn)}`,
    `kilo_key=${present(config.kiloGatewayKey)}`,
    `google_refresh=${present(config.googleOauthRefreshToken)}`,
  ].join(' ')
}
