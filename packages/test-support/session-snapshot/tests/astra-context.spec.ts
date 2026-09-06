import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { installLlmReplay, parseSessionLog, type ReplayConfig } from '@deepseek-ai/dsh-llm-replay'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import TokenMeter from '@deepseek-ai/dsh-token-meter'

const scenario = new URL('../../../../snapshots/session/astra-context/', import.meta.url)
const fixture = new URL('session.v2.jsonl', scenario)

describe('Astra context snapshot', () => {
  it('records max effort and 1M capacity while compacting at 900000, not 899999', async () => {
    const events = parseSessionLog(await readFile(fixture, 'utf8'))
    const rows = load(await readFile(new URL('cordis.snapshot.yml', scenario), 'utf8')) as Array<{
      insert?: Array<{ name: string; config: Pick<ReplayConfig, 'providers'> }>
    }>
    const config = rows.flatMap(row => row.insert ?? [])
      .find(row => row.name === '@deepseek-ai/dsh-llm-replay')?.config
    if (config === undefined) throw new Error('Astra snapshot must declare its replay adapter')

    const ctx = new Context()
    try {
      await ctx.plugin(LlmRuntime)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(TokenMeter)
      const replay = installLlmReplay(ctx, { ...config, file: fileURLToPath(fixture) })
      ctx.effect(() => replay.dispose)

      const endOf = (step: number): number => {
        const index = events.findIndex(event => event.type === 'step/end' && event.data.step === step)
        if (index < 0) throw new Error(`Astra snapshot has no completed step ${step}`)
        return index
      }
      const pressureAfter = (step: number): number => ctx.tokenMeter.measure(
        Session.create(SessionId('astra-pressure-fixture'), events.slice(0, endOf(step) + 1)),
      ).totalTokens

      expect(pressureAfter(2)).toBe(899_999)
      expect(pressureAfter(3)).toBe(900_000)
      const compactStarts = events.filter(event => event.type === 'compaction/start')
      expect(compactStarts).toHaveLength(1)
      expect(compactStarts[0]?.seq).toBe(endOf(3) + 1)

      const session = Session.create(SessionId('astra-completed-fixture'), events)
      expect(session.requestContext()).toEqual({
        provider: 'openai', model: 'gpt-6-astra', contextWindow: 1_000_000,
      })
      expect(session.requestHeader()?.config).toEqual({
        provider: 'openai', model: 'gpt-6-astra', reasoningEffort: 'max', maxTokens: 128_000,
      })
      const imageResult = events.find(event => event.type === 'tool/result'
        && event.data.message.source.callId === 'astra-image')
      expect(imageResult).toBeDefined()
      expect(session.surface.nodes).toContain(imageResult?.seq)
      expect(events.find(event => event.type === 'compaction/summary')?.data).toMatchObject({
        provider: 'openai', model: 'gpt-6-astra', maxTokens: 8192,
      })
      expect(events.at(-1)).toMatchObject({
        type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } },
      })
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
