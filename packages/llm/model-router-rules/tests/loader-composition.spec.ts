import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import RulesModelRouter from '@deepseek-ai/dsh-model-router-rules'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('model-router-rules real Loader composition', () => {
  it('mounts ctx.modelRouter from the flat YAML rule list', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-model-router-rules-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-model-router-rules'",
      '  config:',
      '    rules:',
      '      - id: short-question',
      '        maxBytes: 200',
      "        pattern: '[?？]\\s*$'",
      '        reasoningEffort: low',
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (specifier === '@deepseek-ai/dsh-model-router-rules') return RulesModelRouter
        throw new Error(`unexpected Loader import: ${specifier}`)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(configPath).href },
    })
    await context.loader.await()

    expect(context.get('modelRouter')).toBeInstanceOf(RulesModelRouter)
    const baseline = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }
    await expect(context.modelRouter.route({ baseline, prompt: { text: '现在几点？', hasImage: false } }))
      .resolves.toEqual({
        selection: { ...baseline, reasoningEffort: 'low' },
        reason: 'rule "short-question" matched',
        rule: 'short-question',
      })
  })
})
