// Render WALKTHROUGH_ST.md as the page body. Inlined at build time via Vite's
// `?raw` import so it works in both dev and adapter-node builds. Parallels the
// /walkthrough route, which renders the production-OT walkthrough.

import type { PageServerLoad } from './$types';
import md from '../../../WALKTHROUGH_ST.md?raw';

export const load: PageServerLoad = () => {
  return { md };
};
