import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { messageOf, parseTodoDocument, scanProjects, settingsProblems } from '../src/scan.ts'

describe('parseTodoDocument', () => {
  it('reads checkbox and plain items with their section and depth', () => {
    const text = [
      '# Plan',
      '',
      'Intro paragraph, not an item.',
      '- [ ] open one',
      '- [x] done one',
      '  - [X] nested done',
      '\t- nested plain',
      '## Later',
      '1. numbered open',
      '2) numbered too',
      '* [ ]   spaced   ',
      '- ',
    ].join('\n')
    const parsed = parseTodoDocument(text, 100)
    expect(parsed.items).toEqual([
      { line: 4, text: 'open one', status: 'open', checkbox: true, depth: 0, section: 'Plan' },
      { line: 5, text: 'done one', status: 'done', checkbox: true, depth: 0, section: 'Plan' },
      { line: 6, text: 'nested done', status: 'done', checkbox: true, depth: 1, section: 'Plan' },
      { line: 7, text: 'nested plain', status: 'open', checkbox: false, depth: 1, section: 'Plan' },
      { line: 9, text: 'numbered open', status: 'open', checkbox: false, depth: 0, section: 'Later' },
      { line: 10, text: 'numbered too', status: 'open', checkbox: false, depth: 0, section: 'Later' },
      { line: 11, text: 'spaced', status: 'open', checkbox: true, depth: 0, section: 'Later' },
    ])
    expect(parsed.open).toBe(5)
    expect(parsed.done).toBe(2)
    expect(parsed.truncated).toBe(false)
  })

  it('skips fenced code and closes a fence only with a matching marker', () => {
    const text = [
      '- [ ] before',
      '```md',
      '- [ ] inside fence',
      '~~~',
      '- [ ] still inside (tilde does not close a backtick fence)',
      '```',
      '- [ ] after',
      '~~~~',
      '- [ ] inside tilde fence',
      '~~~',
      '- [ ] inside still (shorter run does not close)',
      '~~~~~',
      '- [ ] last',
    ].join('\n')
    const parsed = parseTodoDocument(text, 100)
    expect(parsed.items.map(item => item.text)).toEqual(['before', 'after', 'last'])
  })

  it('counts every item but lists only the budget, with CRLF endings and closed headings', () => {
    const text = '# Title ##\r\n- [ ] a\r\n- [x] b\r\n- c\r\n'
    const parsed = parseTodoDocument(text, 2)
    expect(parsed.items.map(item => [item.text, item.section])).toEqual([['a', 'Title'], ['b', 'Title']])
    expect(parsed.open).toBe(2)
    expect(parsed.done).toBe(1)
    expect(parsed.truncated).toBe(true)
  })

  it('reads an empty document as no items', () => {
    expect(parseTodoDocument('', 10)).toEqual({ items: [], open: 0, done: 0, truncated: false })
  })
})

describe('settingsProblems', () => {
  it('accepts absolute roots and project-relative patterns', () => {
    expect(settingsProblems({ roots: ['/tmp/a'], files: ['TODO.md', 'docs/*.md', '**/TODO'], includeWorkspaces: true })).toEqual([])
  })

  it('names every relative root, blank pattern, and escaping pattern', () => {
    const problems = settingsProblems({
      roots: ['relative/dir'],
      files: [' ', '/etc/TODO.md', '../TODO.md', 'docs/../../x'],
      includeWorkspaces: false,
    })
    expect(problems).toEqual([
      'root must be an absolute path: "relative/dir"',
      'file pattern must not be blank',
      'file pattern must stay inside the project: "/etc/TODO.md"',
      'file pattern must stay inside the project: "../TODO.md"',
      'file pattern must stay inside the project: "docs/../../x"',
    ])
  })
})

describe('messageOf', () => {
  it('reads an Error message and stringifies anything else', () => {
    expect(messageOf(new Error('boom'))).toBe('boom')
    expect(messageOf('plain')).toBe('plain')
  })
})

describe('scanProjects ordering', () => {
  const dirs: string[] = []
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
  })

  it('orders same-name projects by path, same-depth documents by name, and names the filesystem root by its path', async () => {
    const a = await mkdtemp(join(tmpdir(), 'dsh-scan-a-'))
    const b = await mkdtemp(join(tmpdir(), 'dsh-scan-b-'))
    dirs.push(a, b)
    for (const root of [a, b]) {
      await mkdir(join(root, 'same'))
      await writeFile(join(root, 'same', 'NOTES.md'), '- [ ] two\n')
      await writeFile(join(root, 'same', 'TODO.md'), '- [ ] one\n')
    }
    const snapshot = await scanProjects({
      settings: { roots: ['relative', a, b], files: ['TODO.md', 'NOTES.md', 'etc/hosts'], includeWorkspaces: true },
      limits: { maxDepth: 2, maxFileBytes: 65536, maxItemsPerFile: 10 },
      workspacePaths: ['/'],
    })
    expect(snapshot.warnings[0]).toEqual({ path: '', message: 'root must be an absolute path: "relative"' })
    const same = snapshot.projects.filter(project => project.name === 'same')
    expect(same.map(project => project.path)).toEqual([join(a, 'same'), join(b, 'same')].sort())
    expect(same[0]!.files.map(file => file.relativePath)).toEqual(['NOTES.md', 'TODO.md'])
    const fsRoot = snapshot.projects.find(project => project.path === '/')
    expect(fsRoot).toMatchObject({ name: '/', sources: ['workspace'] })
    expect(fsRoot!.files.map(file => file.relativePath)).toEqual(['etc/hosts'])
  })
})
