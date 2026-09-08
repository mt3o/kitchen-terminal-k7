import { defineConfig } from 'drizzle-kit';

// drizzle-kit 0.31.x config shape for SQLite via better-sqlite3.
// Verified against node_modules/drizzle-kit/index.d.ts (Config type) and
// https://orm.drizzle.team/docs/get-started-sqlite — for the plain
// better-sqlite3 driver, `dialect: 'sqlite'` takes NO `driver` field and
// `dbCredentials` is `{ url: string }`, where `url` is just a filesystem
// path to the .sqlite file (not an actual URL — the field name is shared
// with libsql/turso configs).
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/server/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.K7_DB_PATH ?? './data/k7.sqlite',
  },
  strict: true,
  verbose: true,
});
