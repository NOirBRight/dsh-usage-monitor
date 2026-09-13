/**
 * Read a JSONL session artifact as plaintext for usage folding.
 * Concatenated Zstandard frames match the JSONL persistence backend's
 * on-disk container; unknown Host event types stay in the text and are
 * skipped by the fold rather than refusing the whole log.
 */
interface ZstdFrameRange {
    start: number;
    end: number;
}
/**
 * Locate complete concatenated Zstandard frames without decompressing them.
 * @param buffer - artifact bytes.
 * @returns complete frame ranges; a torn final frame is omitted.
 */
export declare function scanZstdFrames(buffer: Buffer): readonly ZstdFrameRange[];
/**
 * Decode concatenated Zstandard frames into UTF-8 JSONL.
 * @param buffer - `.jsonl.zstd` artifact bytes.
 * @returns plaintext JSONL, including a torn-free complete-frame prefix.
 */
export declare function decodeZstdJsonl(buffer: Buffer): string;
/**
 * Read one session artifact as UTF-8 JSONL.
 * @param path - backend-reported artifact path.
 * @param signal - optional cancellation for the file read.
 * @returns plaintext JSONL.
 */
export declare function readSessionArtifact(path: string, signal?: AbortSignal): Promise<string>;
/**
 * Pull the backend diagnostic path off a persistence refusal, when present.
 * @param error - open/read failure.
 * @returns absolute artifact path, or `undefined`.
 */
export declare function artifactPathFromError(error: unknown): string | undefined;
export {};
//# sourceMappingURL=artifact.d.ts.map