/**
 * A local backup of every voice-input transcription's audio and text —
 * kept for a bounded window, for reviewing/debugging what the gateway
 * actually did with a given clip, not part of the product's own data model
 * (that's `ai_calls`; this is plain files, same "just the filesystem"
 * discipline the TLS certificate store already uses under `certDir`).
 *
 * Never sent anywhere — this stays on the LAN box's disk, distinct from the
 * "audio/transcript never reaches Sentry" rule in routes/chat.ts, which is
 * about outbound telemetry, not local storage.
 */
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface TranscriptArchiveEntry {
  audio: Buffer
  contentType: string
  text: string
  model: string
}

/** The content-types the chat route's transcribe endpoint actually accepts. */
const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
}

/** Strips any `;codecs=...` parameter before the lookup. */
function extensionFor(contentType: string): string {
  const base = contentType.split(';')[0]?.trim().toLowerCase()
  return (base && EXTENSION_BY_CONTENT_TYPE[base]) || 'bin'
}

/**
 * Writes one clip's audio and transcript as a pair of files sharing a
 * timestamp+id basename — `<stamp>-<id>.input.<ext>` and
 * `<stamp>-<id>.output.json` — so a human (or `pruneTranscriptArchive`)
 * can reason about age from the filename alone, without opening anything.
 */
export async function archiveTranscription(dir: string, entry: TranscriptArchiveEntry, now: Date = new Date()): Promise<void> {
  await mkdir(dir, { recursive: true })
  const stamp = now.toISOString().replace(/[:.]/g, '-')
  const base = `${stamp}-${randomUUID()}`
  const output = {
    text: entry.text,
    model: entry.model,
    contentType: entry.contentType,
    createdAt: now.toISOString(),
  }
  await Promise.all([
    writeFile(join(dir, `${base}.input.${extensionFor(entry.contentType)}`), entry.audio),
    writeFile(join(dir, `${base}.output.json`), JSON.stringify(output, null, 2)),
  ])
}

/**
 * Deletes archived files whose mtime is older than `maxAgeMs`. Returns how
 * many files were removed, for the boot-log line to say something real
 * rather than "ran, who knows what it did".
 */
export async function pruneTranscriptArchive(dir: string, maxAgeMs: number, now: Date = new Date()): Promise<number> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch (err) {
    // Nothing archived yet is not a failure — the directory is created lazily
    // by the first archive write, not at boot.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 0
    throw err
  }

  let removed = 0
  for (const name of names) {
    const path = join(dir, name)
    const info = await stat(path)
    if (now.getTime() - info.mtimeMs > maxAgeMs) {
      await unlink(path)
      removed += 1
    }
  }
  return removed
}
