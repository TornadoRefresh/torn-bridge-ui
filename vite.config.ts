import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

const stub = fileURLToPath(new URL('./src/stubs/wormhole.ts', import.meta.url))

export default defineConfig({
  base: './',
  plugins: [nodePolyfills({ include: ['buffer', 'process', 'stream', 'util', 'events'], globals: { Buffer: true, process: true } })],
  define: { 'process.env': {} },
  resolve: {
    alias: [
      { find: /^@wormhole-foundation\/sdk(\/.*)?$/, replacement: stub },
    ],
  },
  build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 1500 },
  server: { port: 5173 },
})
