import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { FileSettingsProvider } from '@deepseek-ai/dsh-settings-file'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import ProjectTodosService, { PROJECT_TODOS_SETTINGS_NAMESPACE, type Config, type ProjectTodosSnapshot } from '../src/index.ts'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!()
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-project-todos-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

async function seed(root: string): Promise<void> {
  await mkdir(join(root, 'alpha', 'notes'), { recursive: true })
  await mkdir(join(root, 'beta'), { recursive: true })
  await mkdir(join(root, 'node_modules', 'dep'), { recursive: true })
  await mkdir(join(root, '.hidden'), { recursive: true })
  await mkdir(join(root, 'empty'), { recursive: true })
  await writeFile(join(root, 'alpha', 'TODO.md'), '# Alpha\n- [ ] ship it\n- [x] plan it\n')
  await writeFile(join(root, 'alpha', 'notes', 'TODO.md'), '- [ ] write docs\n')
  await writeFile(join(root, 'beta', 'todo.md'), '- first\n- second\n')
  await writeFile(join(root, 'node_modules', 'dep', 'TODO.md'), '- [ ] never listed\n')
  await writeFile(join(root, '.hidden', 'TODO.md'), '- [ ] never listed\n')
  await writeFile(join(root, 'TODO.md'), '- [ ] root level\n')
}

function config(overrides: Partial<Config> = {}): Config {
  return {
    roots: [],
    files: ['TODO.md', 'todo.md', 'notes/TODO.md'],
    includeWorkspaces: true,
    maxDepth: 2,
    maxFileBytes: 4096,
    maxItemsPerFile: 50,
    watchDebounceMs: 20,
    ...overrides,
  }
}

async function boot(cfg: Config, settingsPath?: string): Promise<Context> {
  const ctx = new Context()
  cleanups.push(async () => { await ctx.fiber.dispose() })
  if (settingsPath !== undefined) await ctx.plugin(FileSettingsProvider, { path: settingsPath, watch: false })
  await ctx.plugin(ProjectTodosService, cfg)
  return ctx
}

function changedOnce(ctx: Context): Promise<ProjectTodosSnapshot> {
  return new Promise((resolve) => {
    const dispose = ctx.on('project-todos/changed', (snapshot) => {
      dispose()
      resolve(snapshot)
    })
  })
}

describe('ProjectTodosService public contract', () => {
  it('publishes the exact Gateway namespace and Remote method names', async () => {
    const ctx = await boot(config())
    expect(ctx.projectTodos.typertRemote.namespace).toBe('projectTodos')
    expect(remoteMethods(ctx.projectTodos).map(marker => marker.method)).toEqual(['get', 'rescan', 'readDocument'])
  })

  it('rejects a relative root or an escaping pattern at construction', () => {
    expect(() => new ProjectTodosService(new Context(), config({ roots: ['relative'] }))).toThrow(/absolute path/u)
    expect(() => new ProjectTodosService(new Context(), config({ files: ['../x'] }))).toThrow(/stay inside/u)
  })

  it('serves an empty snapshot with the composed settings when nothing is configured', async () => {
    const ctx = await boot(config({ includeWorkspaces: false }))
    const snapshot = ctx.projectTodos.get()
    expect(snapshot.scannedAt).not.toBeNull()
    expect(snapshot.projects).toEqual([])
    expect(snapshot.candidates).toBe(0)
    expect(snapshot.settings).toEqual({ roots: [], files: ['TODO.md', 'todo.md', 'notes/TODO.md'], includeWorkspaces: false })
  })
})

describe('scanning', () => {
  it('lists each root, its visible subdirectories, and the matched documents', async () => {
    const root = await tempDir()
    await seed(root)
    const ctx = await boot(config({ roots: [root], includeWorkspaces: false }))
    const snapshot = ctx.projectTodos.get()
    expect(snapshot.candidates).toBe(4)
    expect(snapshot.warnings).toEqual([])
    expect(snapshot.projects.map(project => [project.name, project.sources, project.open, project.done])).toEqual([
      ['alpha', ['root'], 2, 1],
      ['beta', ['root'], 2, 0],
      [root.split('/').pop(), ['root'], 1, 0],
    ])
    const alpha = snapshot.projects[0]!
    expect(alpha.files.map(file => [file.relativePath, file.items.length, file.truncated])).toEqual([
      ['TODO.md', 2, false],
      ['notes/TODO.md', 1, false],
    ])
    expect(alpha.files[0]!.items[0]).toEqual({ line: 2, text: 'ship it', status: 'open', checkbox: true, depth: 0, section: 'Alpha' })
  })

  it('merges a registered workspace with a root subdirectory and lists workspace-only projects', async () => {
    const root = await tempDir()
    await seed(root)
    const elsewhere = await tempDir()
    await writeFile(join(elsewhere, 'TODO.md'), '- [ ] elsewhere\n')
    const ctx = new Context()
    cleanups.push(async () => { await ctx.fiber.dispose() })
    ctx.provide('workspaceRegistry', { list: () => [{ path: join(root, 'alpha') }, { path: elsewhere }, { path: join(root, 'missing') }] } as never)
    await ctx.plugin(ProjectTodosService, config({ roots: [root] }))
    const snapshot = ctx.projectTodos.get()
    const alpha = snapshot.projects.find(project => project.name === 'alpha')!
    expect(alpha.sources).toEqual(['root', 'workspace'])
    expect(snapshot.projects.find(project => project.path === elsewhere)?.sources).toEqual(['workspace'])
    expect(snapshot.projects.some(project => project.path.endsWith('missing'))).toBe(false)
    expect(snapshot.warnings.map(warning => warning.path)).toEqual([])
  })

  it('warns about an unreadable root and an oversized document without failing the scan', async () => {
    const root = await tempDir()
    await seed(root)
    await writeFile(join(root, 'beta', 'todo.md'), `- [ ] ${'x'.repeat(100)}\n`)
    const ctx = await boot(config({ roots: [root, join(root, 'nowhere')], includeWorkspaces: false, maxFileBytes: 64 }))
    const snapshot = ctx.projectTodos.get()
    expect(snapshot.warnings.map(warning => warning.path)).toEqual([join(root, 'nowhere'), join(root, 'beta', 'todo.md')])
    const beta = snapshot.projects.find(project => project.name === 'beta')!
    expect(beta.files[0]).toMatchObject({ items: [], open: 0, done: 0, truncated: true })
  })

  it('rescans on demand and publishes only when the result differs', async () => {
    const root = await tempDir()
    await seed(root)
    const ctx = await boot(config({ roots: [root], includeWorkspaces: false, watchDebounceMs: 100_000 }))
    const changed = vi.fn()
    ctx.on('project-todos/changed', changed)
    const same = await ctx.projectTodos.rescan()
    expect(changed).not.toHaveBeenCalled()
    expect(same.projects).toEqual(ctx.projectTodos.get().projects)
    await writeFile(join(root, 'empty', 'TODO.md'), '- [ ] now populated\n')
    const next = await ctx.projectTodos.rescan()
    expect(changed).toHaveBeenCalledTimes(1)
    expect(next.projects.map(project => project.name)).toContain('empty')
    expect(ctx.projectTodos.get()).toBe(next)
  })

  it('collapses concurrent rescans onto one running scan plus one follow-up', async () => {
    const root = await tempDir()
    await seed(root)
    const ctx = await boot(config({ roots: [root], includeWorkspaces: false, watchDebounceMs: 100_000 }))
    const [a, b, c] = await Promise.all([ctx.projectTodos.rescan(), ctx.projectTodos.rescan(), ctx.projectTodos.rescan()])
    expect(a.scannedAt).not.toBeNull()
    expect(b).toBe(c)
    expect(ctx.projectTodos.get()).toBe(c)
  })
})

describe('watching', () => {
  it('rescans after a listed document changes and after a new top-level document appears', async () => {
    const root = await tempDir()
    await seed(root)
    const ctx = await boot(config({ roots: [root], includeWorkspaces: false }))
    const edited = changedOnce(ctx)
    await writeFile(join(root, 'alpha', 'TODO.md'), '# Alpha\n- [x] ship it\n- [x] plan it\n')
    const afterEdit = await edited
    expect(afterEdit.projects.find(project => project.name === 'alpha')).toMatchObject({ open: 1, done: 2 })
    const created = changedOnce(ctx)
    await writeFile(join(root, 'empty', 'TODO.md'), '- [ ] fresh\n')
    const afterCreate = await created
    expect(afterCreate.projects.map(project => project.name)).toContain('empty')
  }, 15_000)

  it('rescans when the workspace domain changes while workspaces are included', async () => {
    const root = await tempDir()
    await seed(root)
    const workspaces: { path: string }[] = []
    const ctx = new Context()
    cleanups.push(async () => { await ctx.fiber.dispose() })
    ctx.provide('workspaceRegistry', { list: () => workspaces } as never)
    await ctx.plugin(ProjectTodosService, config({ roots: [], includeWorkspaces: true }))
    expect(ctx.projectTodos.get().projects).toEqual([])
    const changed = changedOnce(ctx)
    workspaces.push({ path: join(root, 'alpha') })
    ctx.emit('domain/changed', { domain: 'workspace', table: '', key: '', operation: 'put', value: {} })
    expect((await changed).projects.map(project => project.name)).toEqual(['alpha'])
    const ignored = vi.fn()
    ctx.on('project-todos/changed', ignored)
    ctx.emit('domain/changed', { domain: 'other', table: '', key: '', operation: 'put', value: {} })
    await new Promise(resolve => setTimeout(resolve, 80))
    expect(ignored).not.toHaveBeenCalled()
  })
})

describe('settings section', () => {
  it('rescans when the user section changes and refuses an unusable write', async () => {
    const root = await tempDir()
    await seed(root)
    const settingsDir = await tempDir()
    const ctx = await boot(config({ roots: [], includeWorkspaces: false }), join(settingsDir, 'settings.yaml'))
    expect(ctx.projectTodos.get().projects).toEqual([])
    const changed = changedOnce(ctx)
    await ctx.settings.update(PROJECT_TODOS_SETTINGS_NAMESPACE, { roots: [root] })
    const snapshot = await changed
    expect(snapshot.settings.roots).toEqual([root])
    expect(snapshot.projects.map(project => project.name)).toContain('alpha')
    await expect(ctx.settings.update(PROJECT_TODOS_SETTINGS_NAMESPACE, { roots: ['relative'] })).rejects.toThrow(/absolute path/u)
    expect(ctx.projectTodos.get().settings.roots).toEqual([root])
  })
})

describe('readDocument', () => {
  it('serves a listed document and refuses everything else', async () => {
    const root = await tempDir()
    await seed(root)
    const ctx = await boot(config({ roots: [root], includeWorkspaces: false }))
    const listed = join(root, 'alpha', 'TODO.md')
    const read = await ctx.projectTodos.readDocument({ path: listed })
    expect(read).toMatchObject({ ok: true, value: { path: listed, text: '# Alpha\n- [ ] ship it\n- [x] plan it\n' } })
    await expect(ctx.projectTodos.readDocument({ path: join(root, 'node_modules', 'dep', 'TODO.md') }))
      .resolves.toEqual({ ok: false, error: { code: 'not-listed', path: join(root, 'node_modules', 'dep', 'TODO.md') } })
    await expect(ctx.projectTodos.readDocument({ path: 'alpha/TODO.md' }))
      .resolves.toEqual({ ok: false, error: { code: 'not-listed', path: 'alpha/TODO.md' } })
  })

  it('reports a listed document that vanished before the read', async () => {
    const root = await tempDir()
    await seed(root)
    const ctx = await boot(config({ roots: [root], includeWorkspaces: false, watchDebounceMs: 100_000 }))
    const listed = join(root, 'beta', 'todo.md')
    await rm(listed)
    const read = await ctx.projectTodos.readDocument({ path: listed })
    expect(read.ok).toBe(false)
    if (!read.ok) expect(read.error).toMatchObject({ code: 'read-failed', path: listed })
  })
})

describe('scan edge cases', () => {
  it('lists nothing when no pattern is configured, names a root by its path when it has no basename', async () => {
    const root = await tempDir()
    await seed(root)
    const ctx = await boot(config({ roots: [root], files: [], includeWorkspaces: false }))
    expect(ctx.projectTodos.get().projects).toEqual([])
    expect(ctx.projectTodos.get().candidates).toBe(4)
  })

  it('skips a document that cannot be read and drops a project left without documents', async () => {
    const root = await tempDir()
    await mkdir(join(root, 'locked'))
    await writeFile(join(root, 'locked', 'TODO.md'), '- [ ] secret\n')
    await chmod(join(root, 'locked', 'TODO.md'), 0o000)
    cleanups.push(() => chmod(join(root, 'locked', 'TODO.md'), 0o644))
    const ctx = await boot(config({ roots: [root], includeWorkspaces: false }))
    const snapshot = ctx.projectTodos.get()
    expect(snapshot.projects).toEqual([])
    expect(snapshot.warnings.map(warning => warning.path)).toEqual([join(root, 'locked', 'TODO.md')])
  })

  it('matches nothing under a workspace path that is not a directory', async () => {
    const root = await tempDir()
    await seed(root)
    const ctx = new Context()
    cleanups.push(async () => { await ctx.fiber.dispose() })
    ctx.provide('workspaceRegistry', { list: () => [{ path: join(root, 'TODO.md') }] } as never)
    await ctx.plugin(ProjectTodosService, config({ roots: [] }))
    const snapshot = ctx.projectTodos.get()
    expect(snapshot.projects).toEqual([])
    expect(snapshot.warnings).toEqual([])
    expect(snapshot.candidates).toBe(1)
  })

  it('releases watched paths a scan no longer lists and closes a watcher with nothing left', async () => {
    const root = await tempDir()
    await seed(root)
    const settingsDir = await tempDir()
    const ctx = await boot(config({ roots: [root], includeWorkspaces: false, watchDebounceMs: 100_000 }), join(settingsDir, 'settings.yaml'))
    expect(ctx.projectTodos.get().projects.map(project => project.name)).toContain('beta')
    await rm(join(root, 'beta', 'todo.md'))
    const next = await ctx.projectTodos.rescan()
    expect(next.projects.map(project => project.name)).not.toContain('beta')
    const cleared = changedOnce(ctx)
    await ctx.settings.update(PROJECT_TODOS_SETTINGS_NAMESPACE, { roots: [] })
    expect((await cleared).projects).toEqual([])
  })

  it('runs a rescan requested while an event is pending, and drops the pending timer and queued scan on dispose', async () => {
    const root = await tempDir()
    await seed(root)
    const ctx = new Context()
    ctx.provide('workspaceRegistry', { list: () => [] } as never)
    const fiber = await ctx.plugin(ProjectTodosService, config({ roots: [root], watchDebounceMs: 100_000 }))
    const service = ctx.projectTodos
    ctx.emit('domain/changed', { domain: 'workspace', table: '', key: '', operation: 'put', value: {} })
    await writeFile(join(root, 'empty', 'TODO.md'), '- [ ] pending\n')
    const next = await service.rescan()
    expect(next.projects.map(project => project.name)).toContain('empty')
    const running = service.rescan()
    const joined = service.rescan()
    ctx.emit('domain/changed', { domain: 'workspace', table: '', key: '', operation: 'put', value: {} })
    await fiber.dispose()
    expect(await running).toBe(next)
    expect(await joined).toBe(next)
  })
})

describe('disposal', () => {
  it('stops scanning and publishing after the plugin is disposed', async () => {
    const root = await tempDir()
    await seed(root)
    const ctx = new Context()
    const fiber = await ctx.plugin(ProjectTodosService, config({ roots: [root], includeWorkspaces: false }))
    const service = ctx.projectTodos
    const before = service.get()
    await fiber.dispose()
    const changed = vi.fn()
    ctx.on('project-todos/changed', changed)
    await writeFile(join(root, 'empty', 'TODO.md'), '- [ ] late\n')
    expect(await service.rescan()).toBe(before)
    await new Promise(resolve => setTimeout(resolve, 80))
    expect(changed).not.toHaveBeenCalled()
  })
})
