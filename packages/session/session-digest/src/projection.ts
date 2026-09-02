/**
 * The `sessionDigest` projection unit: a pure fold of the newest direct human
 * prompt, the closing assistant message answering it, that turn's terminal
 * reason, the files the turn changed, and a bounded history of the questions
 * before it.
 *
 * A direct prompt is `source.kind === 'user'` and nothing else. `user/message`
 * also carries injected context — workspace instructions, time context,
 * compaction checkpoints, goal continuation rounds — which is model-visible
 * surface rather than something a human asked, so folding it here would show a
 * synthetic context block where the user expects their own question.
 *
 * A new direct prompt pushes the previous question into `history` and opens a
 * fresh current question, so a session whose newest question is still being
 * worked reports a `null` outcome instead of the finished state of the
 * question before it. Within one turn the newest `assistant/message` wins,
 * which keeps the model's closing summary rather than an intermediate
 * tool-calling step.
 *
 * Changed files come from the mutation tools' own `tool/result` record — the
 * `diffs[].path` list `dsh-tool-fs` attaches — so a tool joins by declaring
 * what it changed and the fold never guesses from a tool name or its prose.
 *
 * @module @deepseek-ai/dsh-session-digest/projection
 */

import { z } from 'zod'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
// types.ts also carries the client-visible SessionProjectionMap key merge.
import type { SessionDigestOutcome, SessionDigestQuestion, SessionDigestView } from './types.ts'

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    sessionDigest: SessionDigestState
  }
}

/** Budgets applied to each retained value. */
export interface DigestBudgets {
  /** Maximum retained characters of the question. */
  questionChars: number
  /** Maximum retained characters of the answer. */
  replyChars: number
  /** Maximum retained changed-file paths of the current question. */
  changedFilePaths: number
  /** Maximum retained earlier questions. */
  historyQuestions: number
}

const outcomeSchema = z.union([
  z.literal('completed'),
  z.literal('error'),
  z.literal('aborted'),
  z.literal('blocked'),
  z.literal('max-tokens'),
  z.literal('interrupted'),
])

const questionSchema = z.object({
  seq: z.number().int(),
  at: z.number(),
  text: z.string(),
  truncated: z.boolean(),
  outcome: outcomeSchema.nullable(),
  repliedAt: z.number().nullable(),
  changedFileCount: z.number().int(),
}).strict()

const digestSchema = z.object({
  question: z.string().nullable(),
  questionTruncated: z.boolean(),
  questionSeq: z.number().int().nullable(),
  questionAt: z.number().nullable(),
  reply: z.string().nullable(),
  replyTruncated: z.boolean(),
  outcome: outcomeSchema.nullable(),
  replySeq: z.number().int().nullable(),
  repliedAt: z.number().nullable(),
  changedFiles: z.array(z.string()),
  changedFileCount: z.number().int(),
  history: z.array(questionSchema),
}).strict()

/** The fold state is exactly the served view: every field is client-visible. */
type SessionDigestState = z.infer<typeof digestSchema>

const EMPTY: SessionDigestState = {
  question: null,
  questionTruncated: false,
  questionSeq: null,
  questionAt: null,
  reply: null,
  replyTruncated: false,
  outcome: null,
  replySeq: null,
  repliedAt: null,
  changedFiles: [],
  changedFileCount: 0,
  history: [],
}

/**
 * Join a message's text blocks, dropping tool calls, images, and reasoning.
 * @param content - the message's content blocks.
 * @returns the concatenated visible text, empty when the message carries none.
 */
function textOf(content: readonly ContentBlock[]): string {
  return content
    .flatMap(block => (block.type === 'text' ? [block.text] : []))
    .join('\n')
    .trim()
}

/**
 * Cut `text` to `max` characters, reporting whether anything was dropped.
 * @param text - source text.
 * @param max - retained character budget.
 * @returns the retained text and its truncation flag.
 */
function cut(text: string, max: number): { text: string; truncated: boolean } {
  return text.length <= max
    ? { text, truncated: false }
    : { text: text.slice(0, max), truncated: true }
}

/**
 * File paths a mutation tool declared in its result metadata. The record is
 * opaque to the core, so this narrows it at the durable boundary and returns
 * nothing for any other shape.
 * @param meta - the `tool/result` metadata.
 * @returns declared paths in record order, possibly repeating.
 */
function changedPathsOf(meta: unknown): string[] {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return []
  const diffs = (meta as { diffs?: unknown }).diffs
  if (!Array.isArray(diffs)) return []
  const paths: string[] = []
  for (const diff of diffs) {
    if (typeof diff !== 'object' || diff === null) continue
    const path = (diff as { path?: unknown }).path
    if (typeof path === 'string') paths.push(path)
  }
  return paths
}

/**
 * Fold the current question into its history entry.
 * @param state - the state before a new question opens.
 * @returns the entry, or `null` when no question is open.
 */
function toHistory(state: SessionDigestState): SessionDigestQuestion | null {
  if (state.question === null || state.questionSeq === null || state.questionAt === null) return null
  return {
    seq: state.questionSeq,
    at: state.questionAt,
    text: state.question,
    truncated: state.questionTruncated,
    outcome: state.outcome,
    repliedAt: state.repliedAt,
    changedFileCount: state.changedFileCount,
  }
}

/**
 * The unit as registered: a client-visible definition, so `wire` is present
 * rather than optional — which is what `register`'s wire-carrying overload
 * requires.
 */
type DigestUnit =
  & ProjectionDefinition<'sessionDigest', SessionDigestState>
  & Required<Pick<ProjectionDefinition<'sessionDigest', SessionDigestState>, 'wire'>>

/**
 * Build the digest unit against one deployment's budgets.
 * @param budgets - retained budgets for the question, answer, file list, and history.
 * @returns the projection definition to register.
 */
export function createSessionDigestProjectionDefinition(budgets: DigestBudgets): DigestUnit {
  return {
    key: 'sessionDigest',
    stateVersion: 2,
    stateSchema: digestSchema,
    init: () => EMPTY,
    apply: (state, event) => {
      if (event.type === 'user/message') {
        if (event.data.source.kind !== 'user') return state
        const text = textOf(event.data.content)
        if (text === '') return state
        const question = cut(text, budgets.questionChars)
        const previous = toHistory(state)
        const history = previous === null ? state.history : [...state.history, previous]
        return {
          question: question.text,
          questionTruncated: question.truncated,
          questionSeq: event.seq,
          questionAt: event.time,
          reply: null,
          replyTruncated: false,
          outcome: null,
          replySeq: null,
          repliedAt: null,
          changedFiles: [],
          changedFileCount: 0,
          history: history.length > budgets.historyQuestions
            ? history.slice(history.length - budgets.historyQuestions)
            : history,
        }
      }
      if (event.type === 'assistant/message') {
        // An answer without a question would render a headless card; the
        // digest only describes work a human asked for.
        if (state.question === null) return state
        const text = textOf(event.data.message.content)
        if (text === '') return state
        const reply = cut(text, budgets.replyChars)
        return {
          ...state,
          reply: reply.text,
          replyTruncated: reply.truncated,
          replySeq: event.seq,
          repliedAt: event.time,
        }
      }
      if (event.type === 'tool/result') {
        if (state.question === null) return state
        const paths = changedPathsOf(event.data.meta)
        if (paths.length === 0) return state
        // The list keeps the first paths seen up to the budget; the count
        // covers every distinct path, including those the list dropped, so a
        // path beyond the budget is recognized again only through the list —
        // repeats of a dropped path over-count, which the card reports as an
        // approximate "N files" rather than a claim of exactness.
        const known = new Set(state.changedFiles)
        const next = [...state.changedFiles]
        let count = state.changedFileCount
        for (const path of paths) {
          if (known.has(path)) continue
          known.add(path)
          count += 1
          if (next.length < budgets.changedFilePaths) next.push(path)
        }
        if (count === state.changedFileCount) return state
        return { ...state, changedFiles: next, changedFileCount: count }
      }
      if (event.type === 'turn/end') {
        if (state.question === null) return state
        const outcome: SessionDigestOutcome = event.data.reason.kind
        if (state.outcome === outcome) return state
        return { ...state, outcome }
      }
      return state
    },
    wire: {
      viewSchema: digestSchema,
      // The annotated return pins the served value to the published type: a
      // field added to the fold without publishing it fails here.
      view: (state: SessionDigestState): SessionDigestView => state,
    },
  } satisfies ProjectionDefinition<'sessionDigest', SessionDigestState>
}
