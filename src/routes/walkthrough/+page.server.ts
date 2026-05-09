// Render the WALKTHROUGH.md as the page body. Read at SSR-load time so any
// edit to the markdown reflects on next page view (no rebuild needed).

import type { PageServerLoad } from './$types';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const load: PageServerLoad = () => {
  // The CWD when SvelteKit runs is the project root.
  const path = resolve(process.cwd(), 'WALKTHROUGH.md');
  const md = readFileSync(path, 'utf-8');
  return { md };
};
