import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { artifactPathFromError, decodeZstdJsonl, readSessionArtifact, scanZstdFrames } from '../src/artifact.ts'

const tempDirs: string[] = []
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('session artifact decode', () => {
  it('decompresses concatenated Zstandard frames into JSONL', () => {
    const first = zstdCompressSync(Buffer.from('{"type":"session"}\n'))
    const second = zstdCompressSync(Buffer.from('{"type":"assistant/chunk","time":1}\n'))
    const packed = Buffer.concat([first, second])
    expect(scanZstdFrames(packed)).toHaveLength(2)
    expect(decodeZstdJsonl(packed)).toBe('{"type":"session"}\n{"type":"assistant/chunk","time":1}\n')
  })

  it('reads plaintext JSONL and `.zstd` artifacts from disk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'usage-artifact-'))
    tempDirs.push(dir)
    const plain = join(dir, 'session.jsonl')
    const compressed = join(dir, 'session.jsonl.zstd')
    const body = '{"type":"assistant/message","time":2}\n'
    await writeFile(plain, body)
    await writeFile(compressed, zstdCompressSync(Buffer.from(body)))
    expect(await readSessionArtifact(plain)).toBe(body)
    expect(await readSessionArtifact(compressed)).toBe(body)
  })

  it('reads a refusal diagnostic path when present', () => {
    expect(artifactPathFromError(new Error('missing'))).toBeUndefined()
    expect(artifactPathFromError({ location: { kind: 'jsonl', path: '/tmp/session.jsonl.zstd' } }))
      .toBe('/tmp/session.jsonl.zstd')
  })
})
