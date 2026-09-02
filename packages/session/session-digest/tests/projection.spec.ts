/**
 * The `sessionDigest` projection unit: mounting the plugin beside the
 * projection registry serves the newest human question, the closing assistant
 * answer, and the turn's terminal reason; compositions without the registry
 * are unaffected; unmounting the plugin removes the key (HMR safety).
 *
 * The discriminations pinned here are the reasons the fold exists in this
 * shape: injected `user/message` context is not a human question, a new
 * question clears the previous answer so a running task cannot inherit the
 * finished state before it, and the last assistant message of a turn wins so a
 * multi-step turn keeps the model's closing summary.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId, createMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { JsonValue, Session } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import * as SessionDigestPlugin from '@deepseek-ai/dsh-session-digest'
import type { SessionDigestView } from '@deepseek-ai/dsh-session-digest/types'

async function harness(withDigestPlugin: boolean): Promise<{ ctx: Context; session: Session }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  if (withDigestPlugin) await ctx.plugin(SessionDigestPlugin)
  return { ctx, session: ctx.sessions.create(SessionId('digested')) }
}

/** Append one durable human prompt. */
function ask(session: Session, text: string): void {
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
}

/** Append one injected (non-human) context message. */
function inject(session: Session, text: string): void {
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: 'test-context' },
  }), { surfaceOp: 'append' })
}

/** Append one assembled assistant message. */
function answer(session: Session, text: string, step = 1): void {
  session.append('assistant/message', {
    turn: 1,
    step,
    message: createMessage({
      role: 'assistant',
      content: [{ type: 'text', text }],
      source: { kind: 'model', provider: 'mock', model: 'mock' },
    }),
  }, { surfaceOp: 'append', sourceEventSeqs: [] })
}

/** Append one tool result carrying the fs tools' diff record for `paths`. */
function changed(session: Session, paths: readonly string[], meta?: JsonValue): void {
  const callId = CallId(`call-${session.events.length}`)
  const call = session.append('tool/call', { turn: 1, step: 1, callId, name: 'edit', arguments: '{}' })
  session.append('tool/result', {
    turn: 1,
    step: 1,
    message: createToolResultMessage({ callId, content: [{ type: 'text', text: 'ok' }], isError: false }),
    meta: meta === undefined ? { diffs: paths.map(path => ({ path, oldText: null, newText: 'x' })) } : meta,
  }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
}

/** Read the served digest value. */
function digest(ctx: Context, session: Session): SessionDigestView | undefined {
  return ctx.sessionProjections.snapshot(session).values.sessionDigest
}

describe('sessionDigest projection', () => {
  it('serves the newest question with its closing answer and completed outcome', async () => {
    const { ctx, session } = await harness(true)
    ask(session, 'fix the login bug')
    answer(session, 'Fixed: the token refresh raced the redirect.')
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    const view = digest(ctx, session)
    expect(view).toMatchObject({
      question: 'fix the login bug',
      questionTruncated: false,
      reply: 'Fixed: the token refresh raced the redirect.',
      replyTruncated: false,
      outcome: 'completed',
      changedFiles: [],
      changedFileCount: 0,
      history: [],
    })
    expect(typeof view?.questionSeq).toBe('number')
    expect(typeof view?.questionAt).toBe('number')
    expect(typeof view?.replySeq).toBe('number')
    expect(typeof view?.repliedAt).toBe('number')
  })

  it('counts the distinct files the mutation tools declared, bounded by the path budget', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SessionDigestPlugin, { changedFilePaths: 2 })
    const session = ctx.sessions.create(SessionId('files'))
    changed(session, ['before-any-question.ts'])
    ask(session, 'touch files')
    changed(session, ['a.ts', 'a.ts'])
    changed(session, [], { diffs: 'not-a-list' })
    changed(session, [], { diffs: [null, { path: 42 }] })
    changed(session, [], 'plain string meta')
    changed(session, ['b.ts', 'c.ts'])
    changed(session, ['a.ts'])

    expect(digest(ctx, session)).toMatchObject({
      changedFiles: ['a.ts', 'b.ts'],
      changedFileCount: 3,
    })
  })

  it('ignores injected context so the card shows the human question', async () => {
    const { ctx, session } = await harness(true)
    ask(session, 'the real question')
    inject(session, 'AGENTS.md contents the agent was handed')

    expect(digest(ctx, session)?.question).toBe('the real question')
  })

  it('keeps the last assistant message of a multi-step turn', async () => {
    const { ctx, session } = await harness(true)
    ask(session, 'refactor it')
    answer(session, 'Let me look at the files first.', 1)
    answer(session, 'Done: extracted three helpers.', 2)

    expect(digest(ctx, session)?.reply).toBe('Done: extracted three helpers.')
  })

  it('clears the previous answer and outcome when a new question opens', async () => {
    const { ctx, session } = await harness(true)
    ask(session, 'first')
    answer(session, 'first answer')
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    ask(session, 'second')

    expect(digest(ctx, session)).toMatchObject({
      question: 'second',
      reply: null,
      outcome: null,
      replySeq: null,
      changedFileCount: 0,
    })
    const previous = digest(ctx, session)?.history[0]
    expect(previous).toMatchObject({ text: 'first', truncated: false, outcome: 'completed', changedFileCount: 0 })
    expect(typeof previous?.seq).toBe('number')
    expect(typeof previous?.at).toBe('number')
    expect(typeof previous?.repliedAt).toBe('number')
  })

  it('keeps only the newest earlier questions up to the history budget', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SessionDigestPlugin, { historyQuestions: 2 })
    const session = ctx.sessions.create(SessionId('history'))
    ask(session, 'one')
    changed(session, ['x.ts'])
    ask(session, 'two')
    ask(session, 'three')
    ask(session, 'four')

    const view = digest(ctx, session)
    expect(view?.question).toBe('four')
    expect(view?.history.map(entry => entry.text)).toEqual(['two', 'three'])
    expect(view?.history.map(entry => entry.outcome)).toEqual([null, null])
  })

  it('rejects a non-positive budget at load', () => {
    const ctx = new Context()
    expect(() =>{  SessionDigestPlugin.apply(ctx, { historyQuestions: 0 }) }).toThrow(/historyQuestions must be a positive integer, got 0/u)
    expect(() =>{  SessionDigestPlugin.apply(ctx, { changedFilePaths: 1.5 }) }).toThrow(/changedFilePaths/u)
  })

  it('reports a failed turn as its own outcome rather than completion', async () => {
    const { ctx, session } = await harness(true)
    ask(session, 'do it')
    session.append('turn/end', { turn: 1, reason: { kind: 'interrupted' } })

    expect(digest(ctx, session)?.outcome).toBe('interrupted')
  })

  it('ignores text-less prompts, empty answers, and turn ends outside a question', async () => {
    const { ctx, session } = await harness(true)
    session.append('turn/end', { turn: 0, reason: { kind: 'completed' } })
    session.append('user/message', createUserMessage({
      content: [{ type: 'reasoning', text: 'not a question' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    expect(digest(ctx, session)).toMatchObject({ question: null, outcome: null })

    ask(session, 'real')
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'tool-call', id: CallId('c1'), name: 'read', arguments: '{}' }],
        source: { kind: 'model', provider: 'mock', model: 'mock' },
      }),
    }, { surfaceOp: 'append', sourceEventSeqs: [] })
    expect(digest(ctx, session)?.reply).toBeNull()

    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const closed = digest(ctx, session)
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(digest(ctx, session)).toEqual(closed)
  })

  it('leaves an answer without a preceding question unrecorded', async () => {
    const { ctx, session } = await harness(true)
    answer(session, 'orphan')

    expect(digest(ctx, session)).toMatchObject({ question: null, reply: null })
  })

  it('truncates both texts to the configured budgets and flags them', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SessionDigestPlugin, { questionChars: 5, replyChars: 4 })
    const session = ctx.sessions.create(SessionId('capped'))
    ask(session, 'abcdefgh')
    answer(session, 'wxyz1234')

    expect(digest(ctx, session)).toMatchObject({
      question: 'abcde',
      questionTruncated: true,
      reply: 'wxyz',
      replyTruncated: true,
    })
  })

  it('serves no key without the plugin and removes it when unloaded', async () => {
    const { ctx, session } = await harness(false)
    ask(session, 'q')
    expect(digest(ctx, session)).toBeUndefined()

    const fiber = await ctx.plugin(SessionDigestPlugin)
    expect(digest(ctx, session)?.question).toBe('q')

    await fiber.dispose()
    expect(digest(ctx, session)).toBeUndefined()
  })
})
