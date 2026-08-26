import { Buffer } from 'node:buffer'
import type { SessionTelemetryRecord } from '@deepseek-ai/dsh-session-telemetry'

type UnknownObject = Record<string, unknown>

const SAFE_IDENTIFIER_ATTRIBUTE_KEYS = new Set([
  'session.id',
  'session.parent_id',
  'event.type',
  'telemetry.op',
  'agent.id',
  'error.name',
])
const SAFE_NUMBER_ATTRIBUTE_KEYS = new Set(['session.seed_length', 'event.seq', 'turn', 'step'])
const OPERATIONAL_IDENTIFIER = /^[A-Za-z0-9_][A-Za-z0-9._:/-]{0,127}$/

function objectOf(value: unknown): UnknownObject | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as UnknownObject
    : undefined
}

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function identifierOf(value: unknown): string | undefined {
  const candidate = stringOf(value)
  return candidate !== undefined && OPERATIONAL_IDENTIFIER.test(candidate) ? candidate : undefined
}

function finiteNumberOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function booleanOf(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function jsonBytes(value: unknown): number {
  try {
    const json: unknown = JSON.stringify(value)
    return typeof json === 'string' ? Buffer.byteLength(json) : 0
  } catch {
    return 0
  }
}

function put(target: UnknownObject, key: string, value: unknown): void {
  if (value !== undefined) target[key] = value
}

function copyCoordinates(target: UnknownObject, body: UnknownObject | undefined): void {
  put(target, 'turn', finiteNumberOf(body?.turn))
  put(target, 'step', finiteNumberOf(body?.step))
}

function usageMetadata(target: UnknownObject, value: unknown): void {
  const usage = objectOf(value)
  if (usage === undefined) return
  const output: UnknownObject = {}
  for (const key of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']) {
    put(output, key, finiteNumberOf(usage[key]))
  }
  if (Object.keys(output).length > 0) target.usage = output
}

function sourceMetadata(target: UnknownObject, value: unknown): void {
  const source = objectOf(value)
  if (source === undefined) return
  const output: UnknownObject = {}
  put(output, 'kind', identifierOf(source.kind))
  put(output, 'provider', identifierOf(source.provider))
  put(output, 'model', identifierOf(source.model))
  if (Object.keys(output).length > 0) target.source = output
}

function reasonMetadata(target: UnknownObject, value: unknown): void {
  const reason = objectOf(value)
  if (reason === undefined) return
  const output: UnknownObject = {}
  put(output, 'kind', identifierOf(reason.kind))
  const error = objectOf(reason.error)
  put(output, 'errorCode', identifierOf(error?.code))
  const cancel = objectOf(reason.reason)
  put(output, 'cancelKind', identifierOf(cancel?.kind))
  if (Object.keys(output).length > 0) target.reason = output
}

function eventMetadata(eventType: string | undefined, bodyValue: unknown): UnknownObject {
  const body = objectOf(bodyValue)
  const output: UnknownObject = {
    redacted: true,
    originalBodyBytes: jsonBytes(bodyValue),
  }
  copyCoordinates(output, body)

  switch (eventType) {
    case 'turn/end':
      reasonMetadata(output, body?.reason)
      break
    case 'user/message':
      sourceMetadata(output, body?.source)
      put(output, 'contentBytes', jsonBytes(body?.content))
      break
    case 'assistant/chunk': {
      const chunk = objectOf(body?.chunk)
      put(output, 'chunkType', identifierOf(chunk?.type))
      break
    }
    case 'assistant/message': {
      const message = objectOf(body?.message)
      sourceMetadata(output, message?.source)
      usageMetadata(output, body?.usage)
      put(output, 'interrupted', booleanOf(body?.interrupted))
      put(output, 'contentBytes', jsonBytes(message?.content))
      break
    }
    case 'tool/call':
      put(output, 'toolName', identifierOf(body?.name))
      put(output, 'argumentsBytes', jsonBytes(body?.arguments))
      break
    case 'tool/result': {
      const message = objectOf(body?.message)
      const firstBlock = Array.isArray(message?.content) ? objectOf(message.content[0]) : undefined
      const error = objectOf(body?.error)
      put(output, 'isError', booleanOf(firstBlock?.isError))
      put(output, 'errorName', identifierOf(error?.name))
      put(output, 'errorCode', identifierOf(error?.code))
      put(output, 'contentBytes', jsonBytes(message?.content))
      break
    }
    case 'request/context':
      put(output, 'provider', identifierOf(body?.provider))
      put(output, 'model', identifierOf(body?.model))
      put(output, 'contextWindow', finiteNumberOf(body?.contextWindow))
      break
    case 'request/header':
      put(output, 'reason', identifierOf(body?.reason))
      break
    case 'todo/write': {
      const todos = Array.isArray(body?.todos) ? body.todos : []
      const statuses: UnknownObject = {}
      for (const item of todos) {
        const status = stringOf(objectOf(item)?.status)
        if (status === 'pending' || status === 'in_progress' || status === 'completed') {
          statuses[status] = (finiteNumberOf(statuses[status]) ?? 0) + 1
        }
      }
      output.todoCount = todos.length
      if (Object.keys(statuses).length > 0) output.statuses = statuses
      break
    }
    case 'llm/retry': {
      put(output, 'provider', identifierOf(body?.provider))
      const mode = stringOf(body?.mode)
      put(output, 'mode', mode === 'normal' || mode === 'always' ? mode : undefined)
      put(output, 'retry', finiteNumberOf(body?.retry))
      put(output, 'maxRetries', finiteNumberOf(body?.maxRetries))
      put(output, 'delayMs', finiteNumberOf(body?.delayMs))
      const failure = objectOf(body?.failure)
      put(output, 'failureCode', identifierOf(failure?.code))
      break
    }
    case 'llm/retry-started':
      put(output, 'retry', finiteNumberOf(body?.retry))
      break
    default:
      break
  }
  return output
}

/**
 * Prepare one record for the OTLP wire. Metadata-only mode is an allowlist:
 * unknown event bodies retain only their byte size, so newly added event types
 * cannot start exporting content by accident.
 * @param record - candidate record after the seam's deployment waterfall.
 * @param captureContent - whether this backend may preserve raw attributes and body.
 * @returns the record shape handed to the OTel SDK.
 */
export function prepareTelemetryRecord(
  record: SessionTelemetryRecord,
  captureContent: boolean,
): SessionTelemetryRecord {
  if (captureContent) {
    return {
      ...record,
      attributes: { ...record.attributes, 'dsh.telemetry.content_mode': 'full' },
    }
  }

  const attributes: Record<string, string | number> = {}
  for (const [key, value] of Object.entries(record.attributes)) {
    let safeValue: string | number | undefined
    if (SAFE_IDENTIFIER_ATTRIBUTE_KEYS.has(key)) safeValue = identifierOf(value)
    else if (SAFE_NUMBER_ATTRIBUTE_KEYS.has(key)) safeValue = finiteNumberOf(value)
    if (safeValue !== undefined) attributes[key] = safeValue
  }
  attributes['dsh.telemetry.content_mode'] = 'metadata-only'
  attributes['dsh.telemetry.body_bytes'] = jsonBytes(record.body)

  const eventType = identifierOf(record.attributes['event.type'])
  const op = identifierOf(record.attributes['telemetry.op'])
  const body = record.channel === 'ledger'
    ? eventMetadata(eventType, record.body)
    : {
      redacted: true,
      op,
      originalBodyBytes: jsonBytes(record.body),
    }

  return { ...record, attributes, body }
}
