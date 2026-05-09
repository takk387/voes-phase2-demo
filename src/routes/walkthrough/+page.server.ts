// Render the WALKTHROUGH.md as the page body. Inlined at build time via
// Vite's `?raw` import so it works in both dev and adapter-node builds.

import type { PageServerLoad } from './$types';
import md from '../../../WALKTHROUGH.md?raw';

export const load: PageServerLoad = () => {
  return { md };
};
