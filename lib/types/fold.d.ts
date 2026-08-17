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
export interface FoldSessionInput {
    sessionId: string;
    workspaceId: string;
    workspaceTitle: string;
    events: readonly FoldableEvent[];
}
/** Fold one session's events into per-step usage samples. */
export declare function foldSessionUsage(input: FoldSessionInput): StepUsage[];
//# sourceMappingURL=fold.d.ts.map