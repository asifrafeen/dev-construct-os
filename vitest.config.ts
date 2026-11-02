import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Unit tests run in plain Node (it has fetch, Response, FormData and URL) against
 * fixed config, so they never depend on a developer's .env.
 *
 * `npm run test:coverage` writes coverage/lcov.info, which is committed: the Blocks
 * Release pipeline runs the SonarQube scan on the checkout without running tests,
 * so the report has to be in the repo (see sonar-project.properties).
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    env: {
      VITE_BLOCKS_API_URL: 'https://blocksapi.example.com/',
      VITE_BLOCKS_PROJECT_KEY: 'test-project-key',
      VITE_BLOCKS_OIDC_CLIENT_ID: 'test-client-id',
      VITE_BLOCKS_REDIRECT_URI: 'https://app.example.com/login/callback',
      VITE_BLOCKS_HOSTED_LOGIN: 'true',
      VITE_BLOCKS_EXTRA_ARG: '',
    },
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/vite-env.d.ts'],
      reporter: ['text-summary', 'lcovonly'],
    },
  },
});
