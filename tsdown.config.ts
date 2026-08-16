import { defineConfig } from 'tsdown'

/**
 * Popper's publish bundles: root plugin entry and the invariant companion.
 * All workspace/runtime deps stay external — the host dsh installation and npm
 * dependency resolution provide them (in-box names resolve from dsh itself).
 */
export default defineConfig({
  entry: ['src/index.ts', 'src/invariant.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  deps: { neverBundle: [/^node:/, /^@deepseek-ai\//] },
})