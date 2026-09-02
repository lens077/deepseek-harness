import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import SessionInboxService from '../src/index.ts'

export interface TestHarness {
  readonly ctx: Context
  readonly root: string
  disposeInbox(): Promise<void>
  dispose(): Promise<void>
}

/** Compose the service over the real storage hub/domain/JSON backend. */
export async function setupHarness(maxTextBytes = 64): Promise<TestHarness> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-session-inbox-test-'))
  const ctx = new Context()
  let disposeInbox: (() => Promise<void>) | undefined
  try {
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root })
    await ctx.plugin(StorageDomain, { backend: 'json' })
    const fiber = await ctx.plugin(SessionInboxService, { maxTextBytes })
    disposeInbox = fiber.dispose
  } catch (error) {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
    throw error
  }
  if (disposeInbox === undefined) throw new Error('session inbox test plugin did not load')
  return {
    ctx,
    root,
    disposeInbox,
    async dispose() {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    },
  }
}
