/**
 * Migrations run at boot, from Node, not from a CLI in production.
 *
 * The LAN machine starts the service; nobody is standing there to run a deploy
 * step, and a server that boots against a schema it has not migrated is the
 * failure mode this avoids. drizzle-kit stays a development tool for *authoring*
 * migrations; applying them is the application's job.
 */
import { resolve } from 'node:path'

import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

import type { Db } from '../adapters/drizzle/index.ts'

const MIGRATIONS = resolve(import.meta.dirname, '../../../drizzle')

export function runMigrations(db: Db, folder: string = MIGRATIONS): void {
  migrate(db, { migrationsFolder: folder })
}
