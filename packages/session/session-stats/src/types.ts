/**
 * Pure types of the session-stats domain: the ONE home of the `sessionStats`
 * projection-key declaration, free of this package's host-side value imports
 * (cordis context, zod, the llm chunk predicate). Two namespace projections
 * serve it — `./types` for host consumers, `./client` for client aggregates —
 * with zero content duplication.
 *
 * @module @deepseek-ai/dsh-session-stats/types
 */

// Marks this file a module so the declaration below AUGMENTS the projection
// table instead of declaring an ambient module.
export {}

/**
 * Whole-log conversation figures, independent of how much history a client
 * has paged in. Counts and wall times all fold from the complete durable log;
 * every field is 0 until its first contributing event lands. Field names
 * mirror the client window fold so an assembly without this unit can fall
 * back to it wholesale.
 */
export interface SessionStatsProjection {
  /** Distinct turns carrying at least one closed step (`step/end`); rejected or empty turns are uncounted. */
  turns: number
  /** Closed steps (`step/end` events) — completed, failed, and cancelled steps alike. */
  steps: number
  /** Summed complete turn wall time (`turn/start` → `turn/end`) over matched boundaries. */
  turnMs: number
  /** Summed complete step wall time (`step/start` → `step/end`) over matched boundaries. */
  stepMs: number
  /** Summed model wall time (`step/start` → `assistant/message`) over steps that assembled a message. */
  llmMs: number
  /** Summed tool wall time over `tool/call` → `tool/result` pairs matched by callId. */
  toolMs: number
  /** Durable tool dispatches, including calls whose result never landed. */
  toolCalls: number
  /** Durable tool results, including crash-repair results whose dispatch was not retained. */
  toolResults: number
  /** Tool results whose model-facing result carries `isError: true`. */
  toolErrors: number
  /** Provider-routed retry records. */
  llmRetries: number
  /** Summed scheduled delay from provider-routed retry records. */
  retryDelayMs: number
  /** Turns closed normally. */
  completedTurns: number
  /** Turns closed by an execution error. */
  errorTurns: number
  /** Turns closed after a cancellation request. */
  abortedTurns: number
  /** Turns rejected before work could proceed. */
  blockedTurns: number
  /** Turns closed after reaching a model output-token ceiling. */
  maxTokenTurns: number
  /** Crash-orphaned turns closed by session repair. */
  interruptedTurns: number
  /** Summed first-token latency (`step/start` → first non-empty delta chunk) over `ttftSteps`. */
  ttftMs: number
  /** Steps carrying a recorded first token. */
  ttftSteps: number
  /** Summed decode wall time (first token → `assistant/message`) over steps that also report output tokens. */
  decodeMs: number
  /** Summed provider output tokens over the same decode-timed steps. */
  decodeTokens: number
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Whole-log turn/step counts and wall times; see {@link SessionStatsProjection}. */
    sessionStats: SessionStatsProjection
  }
}
