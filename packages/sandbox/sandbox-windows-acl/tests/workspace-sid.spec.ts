/**
 * workspaceRootsWriteSid tests: one exact canonical root set has a stable,
 * order-independent identity. Different sets remain distinct, and canonical
 * path bytes remain the caller's contract.
 */

import { describe, expect, it } from 'vitest'

import { tempWriteSid, workspaceRootsWriteSid } from '../src/index.ts'

describe('workspaceRootsWriteSid', () => {
  it('derives a stable capability-shaped SID per exact root set', () => {
    const first = workspaceRootsWriteSid(['C:\\Users\\agent\\repo', 'D:\\shared'])
    const reordered = workspaceRootsWriteSid(['D:\\shared', 'C:\\Users\\agent\\repo', 'D:\\shared'])
    expect(first).toBe(reordered)
    expect(first).toMatch(/^S-1-4-\d+-\d+-\d+-\d+$/u)
  })

  it('derives distinct identities for distinct complete root sets', () => {
    expect(workspaceRootsWriteSid(['C:\\Users\\agent\\repo-a'])).not.toBe(workspaceRootsWriteSid(['C:\\Users\\agent\\repo-a', 'D:\\shared']))
  })

  it('is byte-sensitive: the canonical path is the caller\'s contract (an alias spelling derives a second identity)', () => {
    expect(workspaceRootsWriteSid(['C:\\Repo'])).not.toBe(workspaceRootsWriteSid(['c:\\repo']))
    expect(workspaceRootsWriteSid(['C:\\Repo\\'])).not.toBe(workspaceRootsWriteSid(['C:\\Repo']))
  })
})

describe('tempWriteSid', () => {
  it('derives a stable domain-separated SID per private temp path', () => {
    const temp = tempWriteSid('C:\\Users\\agent\\AppData\\Local\\Temp\\dsh-abc123')
    expect(temp).toBe(tempWriteSid('C:\\Users\\agent\\AppData\\Local\\Temp\\dsh-abc123'))
    expect(temp).toMatch(/^S-1-4-\d+-\d+-\d+-\d+$/u)
    expect(temp).not.toBe(workspaceRootsWriteSid(['C:\\Users\\agent\\AppData\\Local\\Temp\\dsh-abc123']))
  })

  it('derives distinct capabilities for distinct private temp paths', () => {
    expect(tempWriteSid('C:\\Temp\\dsh-a')).not.toBe(tempWriteSid('C:\\Temp\\dsh-b'))
  })
})
