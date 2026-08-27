/**
 * Fold a session log into per-step usage samples.
 * Same turn/step replaces the earlier sample instead of double-counting.
 */
/** Minimal session-log event the fold understands. */
export interface FoldableEvent {
    type: string;
    time: number;
    data?: unknown;
}
/** One model step's usage, stamped with routing and workspace. */
export interface StepUsage {
    time: number;
    sessionId: string;
    workspaceId: string;
    workspaceTitle: string;
    provider: string;
    model: string;
    uncachedInputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
}
export interface FoldSessionStamp {
    sessionId: string;
    workspaceId: string;
    workspaceTitle: string;
}
export interface FoldSessionInput extends FoldSessionStamp {
    events: readonly FoldableEvent[];
}
export interface FoldRawSessionInput extends FoldSessionStamp {
    content: string;
}
/** Fold one session's events into per-step usage samples. */
export declare function foldSessionUsage(input: FoldSessionInput): StepUsage[];
/**
 * Fold a raw JSONL session without first allocating an event array. Each line
 * is parsed and reduced before the scanner advances to the next newline.
 */
export declare function foldRawSessionUsage(input: FoldRawSessionInput): StepUsage[];
/** Parse one raw JSONL line when it can participate in usage folding. */
export declare function parseRawFoldableEvent(line: string): FoldableEvent | undefined;
//# sourceMappingURL=fold.d.ts.map