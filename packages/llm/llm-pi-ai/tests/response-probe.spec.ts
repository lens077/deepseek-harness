import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { annotateTruncatedFinish, createResponseProbe } from '../src/response-probe.ts'

function streamed(text: string, chunkSize: number, headers: Record<string, string> = { 'content-type': 'text/event-stream' }): Response {
  const bytes = new TextEncoder().encode(text)
  let offset = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) { controller.close(); return }
      controller.enqueue(bytes.subarray(offset, offset + chunkSize))
      offset += chunkSize
    },
  })
  return new Response(body, { status: 200, headers })
}

const truncated: StreamChunk = {
  type: 'finish',
  reason: { kind: 'error', failure: { message: 'Anthropic stream ended without a stop reason', code: 'TRANSPORT' } },
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createResponseProbe', () => {
  it('passes the body through unchanged while retaining only the head', async () => {
    const probe = createResponseProbe(5, () => Promise.resolve(streamed('event: error\ndata: {}\n\n', 4)))

    const response = await probe.fetch('http://provider.test/v1/messages')
    const text = await response.text()

    expect(text).toBe('event: error\ndata: {}\n\n')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    expect(probe.response).toEqual({ status: 200, contentType: 'text/event-stream', bytes: text.length, head: 'event' })
  })

  it('records an empty or absent body and a missing content-type', async () => {
    const probe = createResponseProbe(16, () => Promise.resolve(new Response(null, { status: 502 })))

    await probe.fetch('http://provider.test/v1/messages')

    expect(probe.response).toEqual({ status: 502, contentType: undefined, bytes: 0, head: '' })
  })

  it('calls the global fetch resolved at call time when no upstream is given', async () => {
    const probe = createResponseProbe(8)
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(streamed('later-installed', 4))))

    const response = await probe.fetch('http://provider.test/v1/messages', { method: 'POST' })

    expect(await response.text()).toBe('later-installed')
    expect(globalThis.fetch).toHaveBeenCalledWith('http://provider.test/v1/messages', { method: 'POST' })
    expect(probe.response?.head).toBe('later-in')
  })

  it('replaces the recorded response on each fetch', async () => {
    const responses = [streamed('first', 8), streamed('second', 8)]
    const probe = createResponseProbe(16, () => Promise.resolve(responses.shift() as Response))

    await (await probe.fetch('http://provider.test/a')).text()
    await (await probe.fetch('http://provider.test/b')).text()

    expect(probe.response?.head).toBe('second')
  })
})

describe('annotateTruncatedFinish', () => {
  it('leaves non-finish chunks, non-error finishes, other failures, and probe-less finishes alone', () => {
    const usage: StreamChunk = { type: 'usage', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }
    const stop: StreamChunk = { type: 'finish', reason: { kind: 'stop' } }
    const other: StreamChunk = { type: 'finish', reason: { kind: 'error', failure: { message: 'HTTP 500: down', code: 'SERVER' } } }
    const recorded = { status: 200, contentType: 'text/event-stream', bytes: 0, head: '' }

    expect(annotateTruncatedFinish(usage, recorded)).toBe(usage)
    expect(annotateTruncatedFinish(stop, recorded)).toBe(stop)
    expect(annotateTruncatedFinish(other, recorded)).toBe(other)
    expect(annotateTruncatedFinish(truncated, undefined)).toBe(truncated)
  })

  it('names an empty SSE body and keeps the transport code', () => {
    const annotated = annotateTruncatedFinish(truncated, { status: 200, contentType: 'text/event-stream', bytes: 0, head: '' })

    expect(annotated).toEqual({
      type: 'finish',
      reason: {
        kind: 'error',
        failure: {
          message: 'Anthropic stream ended without a stop reason (upstream response: HTTP 200 text/event-stream, empty body)',
          code: 'TRANSPORT',
          status: 200,
        },
      },
    })
  })

  it('omits the body head when the retained bytes are blank', () => {
    const annotated = annotateTruncatedFinish(truncated, { status: 200, contentType: 'text/event-stream', bytes: 3, head: ' \n ' })

    expect(annotated.type === 'finish' && annotated.reason.kind === 'error' ? annotated.reason.failure.message : undefined)
      .toBe('Anthropic stream ended without a stop reason (upstream response: HTTP 200 text/event-stream, 3 body bytes)')
  })

  it('keeps the transport code for an SSE body that stopped mid-protocol', () => {
    const head = 'event: message_start\ndata: {"type":"message_start","usage":{"input_tokens":400}}'
    const annotated = annotateTruncatedFinish(truncated, { status: 200, contentType: 'text/event-stream', bytes: 4000, head })

    expect(annotated.type === 'finish' && annotated.reason.kind === 'error' ? annotated.reason.failure : undefined).toMatchObject({
      code: 'TRANSPORT',
      message: `Anthropic stream ended without a stop reason (upstream response: HTTP 200 text/event-stream, 4000 body bytes, starting: ${JSON.stringify(head)})`,
    })
  })

  it('re-classifies from a bare JSON error body and names a missing content-type', () => {
    const head = '{"error":"Claude API error","status":400,"details":"invalid_request_error"}'
    const annotated = annotateTruncatedFinish(truncated, { status: 200, contentType: undefined, bytes: head.length, head })

    expect(annotated.type === 'finish' && annotated.reason.kind === 'error' ? annotated.reason.failure : undefined).toEqual({
      code: 'INVALID_REQUEST',
      status: 200,
      message: `Anthropic stream ended without a stop reason (upstream response: HTTP 200 no content-type, ${head.length} body bytes, starting: ${JSON.stringify(head)})`,
    })
  })

  it('keeps the transport code when a bare JSON body carries no recognizable words', () => {
    const head = '{"ok":false}'
    const annotated = annotateTruncatedFinish(truncated, { status: 200, contentType: 'application/json', bytes: head.length, head })

    expect(annotated.type === 'finish' && annotated.reason.kind === 'error' ? annotated.reason.failure.code : undefined).toBe('TRANSPORT')
  })
})
