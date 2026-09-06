/** Callback directory reads used by the packed tinyglobby/fdir consumer. */
import { createRequire } from 'node:module'
import { beforeEach, expect, it, vi } from 'vitest'
import { MemoryVfs } from '../../src/storage/memory.ts'
import { setActiveVfs } from '../../src/storage/active.ts'
import fs from '../../src/node/builtin_modules/implemented/fs.ts'

// Resolve the maintained walker from its production consumer's dependency graph.
const consumerRequire = createRequire(new URL('../../../../todo/project-todos/package.json', import.meta.url))
const globRequire = createRequire(consumerRequire.resolve('tinyglobby'))
const { fdir } = globRequire('fdir') as {
  fdir: new (options: { fs: typeof fs }) => {
    withFullPaths(): { crawl(path: string): { withPromise(): Promise<string[]> } }
  }
}

beforeEach(() => {
  const vfs = new MemoryVfs()
  setActiveVfs(vfs)
  vfs.mkdirSync('/dsh/project/nested', { recursive: true })
  vfs.writeFileSync('/dsh/project/TODO.md', '- [ ] root')
  vfs.writeFileSync('/dsh/project/nested/TODO.md', '- [ ] nested')
})

// This host-loaded fdir uses native path.resolve; the Worker always uses POSIX paths.
it.skipIf(process.platform === 'win32')('walks nested VFS files through the real fdir callback consumer', async () => {
  const files = await new fdir({ fs }).withFullPaths().crawl('/dsh/project').withPromise()
  expect(files.sort()).toEqual(['/dsh/project/TODO.md', '/dsh/project/nested/TODO.md'])
})

it('settles names and filesystem errors asynchronously once', async () => {
  for (const [path, code] of [['/dsh/project', null], ['/dsh/missing', 'ENOENT'], ['/dsh/project/TODO.md', 'ENOTDIR']] as const) {
    let returned = false
    const calls: unknown[][] = []
    const done = new Promise<void>((resolve) => {
      fs.readdir(path, (error, entries) => {
        calls.push([returned, error?.code ?? null, entries])
        resolve()
      })
    })
    returned = true
    await done
    expect(calls).toEqual([[true, code, code === null ? ['TODO.md', 'nested'] : undefined]])
  }
})

it('returns the existing Dirent kinds and parent paths with withFileTypes', async () => {
  const entries = await new Promise<unknown>((resolve, reject) => {
    fs.readdir('/dsh/project', { withFileTypes: true }, (error, result) => {
      if (error) reject(error)
      else resolve(result)
    })
  })
  expect(entries).toEqual([
    new fs.Dirent('TODO.md', '/dsh/project', true),
    new fs.Dirent('nested', '/dsh/project', false),
  ])
})

it.each(['/dsh/project', '/dsh/missing'])('does not report a callback exception as a filesystem error for %s', (path) => {
  const tasks: VoidFunction[] = []
  const scheduler = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((task) => { tasks.push(task) })
  try {
    const failure = new Error('consumer callback failed')
    const callback = vi.fn(() => { throw failure })
    fs.readdir(path, callback)
    expect(tasks).toHaveLength(1)
    expect(() => { tasks[0]!() }).toThrow(failure)
    expect(callback).toHaveBeenCalledTimes(1)
  } finally {
    scheduler.mockRestore()
  }
})

it('rejects an omitted callback synchronously', () => {
  // The worker API is also called by untyped packed JavaScript modules.
  expect(() => { Reflect.apply(fs.readdir, fs, ['/dsh/project', {}]) }).toThrow(TypeError)
})
