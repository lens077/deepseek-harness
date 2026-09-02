import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import ProjectTodosService from '../src/index.ts'
import * as ProjectTodosInvariant from '../src/invariant.ts'

describe('project-todos invariant companion', () => {
  it('removes its registry contribution when its fiber is disposed (HMR safety)', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(ProjectTodosService, {
        roots: [], files: [], includeWorkspaces: false, maxDepth: 1, maxFileBytes: 1024, maxItemsPerFile: 10, watchDebounceMs: 10,
      })
      await ctx.plugin(InvariantRegistry)
      const fiber = await ctx.plugin(ProjectTodosInvariant)

      expect(() => {
        ctx.invariants.register('@deepseek-ai/dsh-project-todos', () => {})
      }).toThrow(/already registered/u)

      await fiber.dispose()
      await expect(ctx.plugin(ProjectTodosInvariant).await()).resolves.toBeDefined()
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
