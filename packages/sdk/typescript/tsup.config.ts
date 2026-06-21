import { defineConfig } from 'tsup';

export default defineConfig({
  // Entry points — each becomes its own ESM + CJS bundle
  entry: {
    index: 'src/index.ts',
    hermes: 'src/hermes.ts',
  },

  // Dual format: ESM (.js) and CommonJS (.cjs)
  format: ['esm', 'cjs'],

  // Generate TypeScript declaration files via tsc instead (see package.json scripts)
  dts: false,

  // Keep source maps for debugging
  sourcemap: true,

  // Clean dist/ before each build
  clean: true,

  // Don't bundle workspace peer dependencies
  external: ['@1mbrain/core'],

  // Output ESM as .js, CJS as .cjs
  outExtension({ format }) {
    return {
      js: format === 'cjs' ? '.cjs' : '.js',
    };
  },
});
