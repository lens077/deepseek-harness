/**
 * Deterministic write identities for canonical workspace-root sets and private
 * temporary directories.
 * @module @deepseek-ai/dsh-sandbox-windows-acl/workspace-sid
 */

import { createHash } from 'node:crypto'

/** Convert four digest words into non-zero 30-bit SID subauthorities. */
function digestSubauthorities(digest: Buffer): readonly [number, number, number, number] {
  const value = (offset: number): number => (digest.readUInt32LE(offset) % (2 ** 30 - 1)) + 1
  return [value(0), value(4), value(8), value(12)]
}

/**
 * Derive one write SID for an exact canonical workspace-root set. Sorting makes
 * caller order irrelevant, while length framing prevents path-boundary
 * ambiguity. Every root carrying this SID is authorized only by tokens minted
 * for the same complete set; standing ACEs from a wider or narrower set stay
 * inert. Four 30-bit subauthorities retain 120 digest bits.
 * @param workspaceRoots - non-empty canonical, deduplicated workspace roots.
 * @returns the SDDL string form.
 */
export function workspaceRootsWriteSid(workspaceRoots: readonly string[]): string {
  const roots = [...new Set(workspaceRoots)].sort()
  if (roots.length === 0) throw new Error('workspace root-set SID requires at least one root')
  const hash = createHash('sha256').update('dsh-workspace-write-roots\0', 'utf8')
  for (const root of roots) {
    const bytes = Buffer.from(root, 'utf8')
    const length = Buffer.allocUnsafe(4)
    length.writeUInt32LE(bytes.byteLength)
    hash.update(length).update(bytes)
  }
  const [first, second, third, fourth] = digestSubauthorities(hash.digest())
  return `S-1-4-${first}-${second}-${third}-${fourth}`
}

/**
 * Derive one private temp directory's write SID. The random directory path is
 * the capability identity; a distinct hash domain prevents equality with a
 * workspace-root-set SID.
 * @param tempDir - the private temp directory's absolute path.
 * @returns the SDDL string form.
 */
export function tempWriteSid(tempDir: string): string {
  const digest = createHash('sha256').update('dsh-private-temp\0', 'utf8').update(tempDir, 'utf8').digest()
  const [first, second, third, fourth] = digestSubauthorities(digest)
  return `S-1-4-${first}-${second}-${third}-${fourth}`
}
