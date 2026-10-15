import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['test/**/*.test.ts', 'site/**/*.test.ts'],
    // The site tests parse whole pages; their stylesheets needn't load.
    environmentOptions: {
      happyDOM: {
        settings: { disableCSSFileLoading: true, handleDisabledFileLoadingAsSuccess: true },
      },
    },
  },
});
