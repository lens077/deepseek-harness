/**
 * HTTP response facts for one pi-ai request.
 *
 * pi-ai reads a provider stream through the SDK and, when the body ends
 * without a terminal protocol event, reports only `… stream ended without a
 * stop reason`; the status, media type, and bytes the wire actually carried
 * are gone. A gateway that answers an upstream 4xx with HTTP 200 and an empty
 * or bare-JSON body therefore looks like a transport drop, and the request is
 * retried although resending it cannot succeed. The probe wraps the `fetch`
 * pi-ai's SDK clients call, records the response facts and the first bytes of
 * the body without altering what the SDK reads, and re-classifies a truncated
 * finish from those bytes when they carry the provider's own error.
 *
 * @module dsh-llm-pi-ai/response-probe
 */

import type { FinishReason, StreamChunk } from '@deepseek-ai/dsh-llm'
import { classifyPiAiError } from './stream.ts'

/** Facts recorded from the last response the probed `fetch` returned. */
export interface ProbedResponse {
  readonly status: number
  /** `content-type` response header, or undefined when the provider sent none. */
  readonly contentType: string | undefined
  /** Body bytes observed so far, including those beyond the retained head. */
  readonly bytes: number
  /** The first {@link ResponseProbe} head-limit bytes of the body, decoded as UTF-8. */
  readonly head: string
}

/** One request's `fetch` wrapper and its recorded response. */
export interface ResponseProbe {
  /** Drop-in `fetch` that records the response it returns; pass as pi-ai's `fetch` option. */
  readonly fetch: typeof globalThis.fetch
  /** The last recorded response, or undefined before any response arrived. */
  readonly response: ProbedResponse | undefined
}

/** `fetch`-compatible signature accepted as the probe's upstream. */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

/**
 * Create a probe whose `fetch` records the response status, `content-type`,
 * byte count, and the first `headLimit` body bytes while streaming the body
 * through unchanged.
 * @param headLimit - maximum body bytes retained as {@link ProbedResponse.head}.
 * @param upstream - the transport to call; defaults to the global `fetch` resolved at
 *   call time so a proxy dispatcher installed later still applies.
 * @returns the probe; its `response` is replaced by each new response.
 */
export function createResponseProbe(
  headLimit: number,
  upstream: FetchLike = (input, init) => globalThis.fetch(input, init),
): ResponseProbe {
  let response: ProbedResponse | undefined
  const probedFetch: typeof globalThis.fetch = async (input, init) => {
    const upstreamResponse = await upstream(input, init)
    const contentType = upstreamResponse.headers.get('content-type') ?? undefined
    const status = upstreamResponse.status
    const headChunks: Uint8Array[] = []
    let headBytes = 0
    let bytes = 0
    const decoder = new TextDecoder()
    const record = (): void => {
      response = { status, contentType, bytes, head: decoder.decode(concat(headChunks, headBytes)) }
    }
    record()
    if (upstreamResponse.body === null) return upstreamResponse
    const observed = upstreamResponse.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength
        if (headBytes < headLimit) {
          const slice = chunk.subarray(0, headLimit - headBytes)
          headChunks.push(slice)
          headBytes += slice.byteLength
        }
        record()
        controller.enqueue(chunk)
      },
    }))
    return new Response(observed, {
      status,
      statusText: upstreamResponse.statusText,
      headers: upstreamResponse.headers,
    })
  }
  return {
    fetch: probedFetch,
    get response() { return response },
  }
}

function concat(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

/** pi-ai's wording for a body that ended before its protocol's terminal event. */
const TRUNCATED_STREAM = /stream ended (?:before|without)\b/i

/** One-line rendering of the response facts for a failure message. */
function describe(response: ProbedResponse): string {
  const mediaType = response.contentType ?? 'no content-type'
  const head = response.head.trim()
  const body = response.bytes === 0
    ? 'empty body'
    : `${response.bytes} body bytes${head === '' ? '' : `, starting: ${JSON.stringify(head)}`}`
  return `HTTP ${response.status} ${mediaType}, ${body}`
}

/**
 * Annotate a truncated-stream error finish with the recorded response facts.
 *
 * The message gains the status, media type, byte count, and body head. When
 * the body head is a bare JSON object rather than SSE framing, it is the
 * provider's own error and its recognizable words re-classify the failure
 * (a wrapped upstream `400` stops being a retryable `TRANSPORT`); SSE bodies
 * keep their code because protocol events also contain numbers.
 * @param chunk - a chunk from the pi-ai stream.
 * @param response - the probe's recorded response, or undefined when none arrived.
 * @returns the same chunk, or a finish chunk whose failure names the response.
 */
export function annotateTruncatedFinish(chunk: StreamChunk, response: ProbedResponse | undefined): StreamChunk {
  if (chunk.type !== 'finish' || chunk.reason.kind !== 'error' || response === undefined) return chunk
  const { failure } = chunk.reason
  if (!TRUNCATED_STREAM.test(failure.message)) return chunk
  const head = response.head.trim()
  const bareJson = head.startsWith('{')
  const reclassified = bareJson ? classifyPiAiError(head) : 'PI_AI_ERROR'
  const reason: FinishReason = {
    kind: 'error',
    failure: {
      ...failure,
      message: `${failure.message} (upstream response: ${describe(response)})`,
      code: reclassified === 'PI_AI_ERROR' ? failure.code : reclassified,
      status: response.status,
    },
  }
  return { ...chunk, reason }
}
