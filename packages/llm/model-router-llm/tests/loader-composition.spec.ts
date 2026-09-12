import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import LlmModelRouter from '@deepseek-ai/dsh-model-router-llm'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('model-router-llm real Loader composition', () => {
  it('mounts ctx.modelRouter from the flat YAML choice list', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-model-router-llm-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-llm'",
      "- name: '@deepseek-ai/dsh-model-router-llm'",
      '  config:',
      '    choices:',
      '      - id: fast',
      '        description: Short factual questions.',
      '        provider: deepseek-official',
      '        model: deepseek-v4-flash',
      '    maxInputBytes: 8192',
      '    maxOutputTokens: 16',
      '    timeoutMs: 20000',
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (specifier === '@deepseek-ai/dsh-llm') return LlmRuntime
        if (specifier === '@deepseek-ai/dsh-model-router-llm') return LlmModelRouter
        throw new Error(`unexpected Loader import: ${specifier}`)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(configPath).href },
    })
    await context.loader.await()

    expect(context.get('modelRouter')).toBeInstanceOf(LlmModelRouter)
  })
})
