import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/db/cli.ts'],
  format: ['esm'],
  target: 'node22',
  clean: true,
  sourcemap: true,
  // The shared workspace package ships TypeScript sources, so it is bundled into the output.
  noExternal: ['@loglens/shared'],
});
