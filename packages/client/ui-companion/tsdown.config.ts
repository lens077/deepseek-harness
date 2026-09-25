import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { clientBundle } from '../tsdown.client.ts'

const base = clientBundle('@deepseek-ai/dsh-client-ui-companion', ['lib/types/index.js'])
const assets = fileURLToPath(new URL('./src/client/assets/', import.meta.url))

export default (options: Parameters<typeof base>[0]) => base(options).map(config => ({
  ...config,
  plugins: [...(Array.isArray(config.plugins) ? config.plugins : []), {
    name: 'companion-artwork',
    resolveId(source: string) {
      return source.endsWith('.webp') ? resolve(assets, source.split('/').at(-1)!) : null
    },
    async load(id: string) {
      if (!id.endsWith('.webp')) return null
      const source = resolve(assets, id.split('/').at(-1)!)
      this.addWatchFile(source)
      return `export default ${JSON.stringify(`data:image/webp;base64,${(await readFile(source)).toString('base64')}`)}`
    },
  }],
}))
