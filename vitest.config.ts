import { defineConfig } from 'vitest/config';

// Tests target server-side TS (schema, migrations, rotation engine, cycle math)
// — no Svelte components. Keep the SvelteKit plugin out of the test pipeline
// so we don't need a browser/jsdom environment for what is plain Node work.
export default defineConfig({
  test: {
    include: ['src/lib/server/**/*.test.ts'],
    environment: 'node'
  }
});
