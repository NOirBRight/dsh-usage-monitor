/**
 * Read a JSONL session artifact as plaintext for usage folding.
 * Concatenated Zstandard frames match the JSONL persistence backend's
 * on-disk container; unknown Host event types stay in the text and are
 * skipped by the fold rather than refusing the whole log.
 */

import { readFile } from 'node:fs/promises'
import { zstdDecompressSync } from 'node:zlib'

const ZSTD_MAGIC = 4_247_762_216

interface ZstdFrameRange {
  start: number
  end: number
}

/**
 * Locate complete concatenated Zstandard frames without decompressing them.
 * @param buffer - artifact bytes.
 * @returns complete frame ranges; a torn final frame is omitted.
 */
export function scanZstdFrames(buffer: Buffer): readonly ZstdFrameRange[] {
  const frames: ZstdFrameRange[] = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) return frames
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error(`corrupt Zstandard session log: invalid frame magic at byte ${offset}`)
    }
    offset += 4
    if (offset === buffer.length) return frames
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 24) !== 0) {
      throw new Error(`corrupt Zstandard session log: reserved frame-header bit at byte ${offset - 1}`)
    }
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 32) !== 0
    const checksum = (descriptor & 4) !== 0
    const dictionaryFlag = descriptor & 3
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) return frames
    offset += remainingHeaderBytes
    for (;;) {
      if (buffer.length - offset < 3) return frames
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 3
      const blockSize = blockHeader >>> 3
      if (blockType === 3) {
        throw new Error(`corrupt Zstandard session log: reserved block type at byte ${offset - 3}`)
      }
      const payloadBytes = blockType === 1 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) return frames
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) return frames
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return frames
}

/**
 * Decode concatenated Zstandard frames into UTF-8 JSONL.
 * @param buffer - `.jsonl.zstd` artifact bytes.
 * @returns plaintext JSONL, including a torn-free complete-frame prefix.
 */
export function decodeZstdJsonl(buffer: Buffer): string {
  const frames = scanZstdFrames(buffer)
  if (frames.length === 0) return ''
  const parts: Buffer[] = []
  for (const frame of frames) {
    parts.push(zstdDecompressSync(buffer.subarray(frame.start, frame.end)))
  }
  return Buffer.concat(parts).toString('utf8')
}

/**
 * Read one session artifact as UTF-8 JSONL.
 * @param path - backend-reported artifact path.
 * @param signal - optional cancellation for the file read.
 * @returns plaintext JSONL.
 */
export async function readSessionArtifact(path: string, signal?: AbortSignal): Promise<string> {
  const bytes = await readFile(path, signal === undefined ? undefined : { signal })
  signal?.throwIfAborted()
  return path.endsWith('.zstd') ? decodeZstdJsonl(bytes) : bytes.toString('utf8')
}

/**
 * Pull the backend diagnostic path off a persistence refusal, when present.
 * @param error - open/read failure.
 * @returns absolute artifact path, or `undefined`.
 */
export function artifactPathFromError(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('location' in error)) return undefined
  const location = error.location
  if (typeof location !== 'object' || location === null || !('path' in location)) return undefined
  const path = location.path
  return typeof path === 'string' && path.length > 0 ? path : undefined
}
