/**
 * The voice-input debug backup: every archived clip must be readable back
 * (audio bytes + transcript text intact), and the retention sweep must
 * remove only what has genuinely aged past the window — never a fresh entry,
 * never leave an entry a week old sitting around.
 */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'

import { archiveTranscription, pruneTranscriptArchive } from '../src/server/ai/transcript-archive.ts'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'k7-transcript-archive-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('archiveTranscription', () => {
  it('writes the audio bytes and the transcript text back out losslessly', async () => {
    const audio = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0xff])
    await archiveTranscription(dir, { audio, contentType: 'audio/webm', text: 'kup mleko', model: 'kilo-auto/free' })

    const names = await readdir(dir)
    const input = names.find((n) => n.endsWith('.input.webm'))
    const output = names.find((n) => n.endsWith('.output.json'))
    assert.ok(input, 'no .input.webm file written')
    assert.ok(output, 'no .output.json file written')

    const readBack = await readFile(join(dir, input!))
    assert.deepEqual(readBack, audio)

    const meta = JSON.parse(await readFile(join(dir, output!), 'utf8')) as { text: string; model: string }
    assert.equal(meta.text, 'kup mleko')
    assert.equal(meta.model, 'kilo-auto/free')
  })

  it('maps an unrecognised content-type to a .bin extension rather than failing', async () => {
    await archiveTranscription(dir, { audio: Buffer.from('x'), contentType: 'audio/x-made-up', text: 't', model: 'm' })
    const names = await readdir(dir)
    assert.ok(names.some((n) => n.endsWith('.input.bin')))
  })

  it('creates the directory lazily rather than requiring it to exist', async () => {
    const nested = join(dir, 'does', 'not', 'exist', 'yet')
    await archiveTranscription(nested, { audio: Buffer.from('x'), contentType: 'audio/wav', text: 't', model: 'm' })
    const names = await readdir(nested)
    assert.equal(names.length, 2)
  })
})

describe('pruneTranscriptArchive', () => {
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000

  it('removes files older than the window and leaves fresh ones alone', async () => {
    const oldPath = join(dir, 'old.input.webm')
    const freshPath = join(dir, 'fresh.input.webm')
    await writeFile(oldPath, 'x')
    await writeFile(freshPath, 'x')

    const now = new Date('2026-09-10T00:00:00Z')
    const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000)
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    await utimes(oldPath, eightDaysAgo, eightDaysAgo)
    await utimes(freshPath, oneDayAgo, oneDayAgo)

    const removed = await pruneTranscriptArchive(dir, WEEK_MS, now)

    assert.equal(removed, 1)
    const remaining = await readdir(dir)
    assert.deepEqual(remaining, ['fresh.input.webm'])
  })

  it('does not delete a file sitting exactly at the boundary', async () => {
    const path = join(dir, 'boundary.input.webm')
    await writeFile(path, 'x')
    const now = new Date('2026-09-10T00:00:00Z')
    await utimes(path, new Date(now.getTime() - WEEK_MS), new Date(now.getTime() - WEEK_MS))

    const removed = await pruneTranscriptArchive(dir, WEEK_MS, now)
    assert.equal(removed, 0)
  })

  it('returns 0 rather than throwing when nothing has been archived yet', async () => {
    const neverCreated = join(dir, 'never-created')
    const removed = await pruneTranscriptArchive(neverCreated, WEEK_MS)
    assert.equal(removed, 0)
  })
})
