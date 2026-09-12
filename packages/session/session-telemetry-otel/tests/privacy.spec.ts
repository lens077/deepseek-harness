import { describe, expect, it } from 'vitest'
import type { SessionTelemetryRecord } from '@deepseek-ai/dsh-session-telemetry'
import { prepareTelemetryRecord } from '../src/privacy.ts'

const SECRET = 'sk-fixture-must-not-leave'

function record(overrides: Partial<SessionTelemetryRecord> = {}): SessionTelemetryRecord {
  return {
    channel: 'ledger',
    time: 1,
    severity: 'info',
    attributes: {
      'session.id': 'session-1',
      'event.type': 'assistant/message',
      'event.seq': 7,
      'session.cwd': `/private/${SECRET}`,
      unsafe: SECRET,
    },
    body: {
      turn: 2,
      step: 3,
      message: {
        source: { kind: 'model', provider: 'deepseek', model: 'chat' },
        content: [{ type: 'text', text: SECRET }],
      },
      usage: { inputTokens: 11, outputTokens: 5, cacheReadTokens: 7 },
    },
    ...overrides,
  }
}

describe('OTel metadata-only privacy preparation', () => {
  it('preserves searchable lifecycle and usage metadata without content, cwd, or unknown attributes', () => {
    const prepared = prepareTelemetryRecord(record(), false)
    expect(prepared.attributes).toMatchObject({
      'session.id': 'session-1',
      'event.type': 'assistant/message',
      'event.seq': 7,
      'dsh.telemetry.content_mode': 'metadata-only',
    })
    expect(prepared.attributes).not.toHaveProperty('session.cwd')
    expect(prepared.attributes).not.toHaveProperty('unsafe')
    expect(prepared.body).toMatchObject({
      redacted: true,
      turn: 2,
      step: 3,
      source: { kind: 'model', provider: 'deepseek', model: 'chat' },
      usage: { inputTokens: 11, outputTokens: 5, cacheReadTokens: 7 },
    })
    expect(JSON.stringify(prepared)).not.toContain(SECRET)
  })

  it('drops opaque call ids and rejects prose-shaped operational identifiers', () => {
    const prepared = prepareTelemetryRecord(record({
      attributes: {
        'session.id': `session ${SECRET}`,
        'event.type': 'tool/call',
        'event.seq': 8,
        'agent.id': `agent ${SECRET}`,
      },
      body: {
        turn: 2,
        step: 3,
        callId: `call-${SECRET}`,
        name: `read ${SECRET}`,
        arguments: JSON.stringify({ secret: SECRET }),
      },
    }), false)
    expect(prepared.attributes).not.toHaveProperty('session.id')
    expect(prepared.attributes).not.toHaveProperty('agent.id')
    expect(prepared.body).not.toHaveProperty('callId')
    expect(prepared.body).not.toHaveProperty('toolName')
    expect(JSON.stringify(prepared)).not.toContain(SECRET)
  })

  it('uses a closed allowlist for unknown event bodies', () => {
    const prepared = prepareTelemetryRecord(record({
      attributes: { 'session.id': 'session-1', 'event.type': 'plugin/new-sensitive-event', 'event.seq': 8 },
      body: { futurePayload: SECRET },
    }), false)
    expect(prepared.body).toMatchObject({ redacted: true })
    if (typeof prepared.body !== 'object' || prepared.body === null) {
      throw new TypeError('metadata body must be an object')
    }
    expect(typeof Reflect.get(prepared.body, 'originalBodyBytes')).toBe('number')
    expect(Object.keys(prepared.body)).toEqual(['redacted', 'originalBodyBytes'])
    expect(JSON.stringify(prepared)).not.toContain(SECRET)
  })

  it('removes operational error messages while retaining their classification', () => {
    const prepared = prepareTelemetryRecord(record({
      channel: 'ops',
      severity: 'error',
      attributes: {
        'telemetry.op': 'agent-error',
        'session.id': 'session-1',
        'agent.id': 'agent-1',
        'error.name': 'Error',
        turn: 2,
        step: 3,
      },
      body: { name: 'Error', message: SECRET },
    }), false)
    expect(prepared.body).toMatchObject({ redacted: true, op: 'agent-error' })
    expect(JSON.stringify(prepared)).not.toContain(SECRET)
  })

  it('exports raw bodies only after explicit content opt-in', () => {
    const prepared = prepareTelemetryRecord(record(), true)
    expect(prepared.attributes['dsh.telemetry.content_mode']).toBe('full')
    expect(JSON.stringify(prepared)).toContain(SECRET)
  })
})
