import type { Handle } from '@sveltejs/kit';
import { DEFAULT_PERSONA_ID, findPersona, PERSONAS } from '$lib/personas';
import { ensureSeeded } from '$lib/server/seed';

const PERSONA_COOKIE = 'voes_persona';

// On first boot (e.g. fresh Railway deploy with an empty persistent volume),
// auto-seed so the demo is immediately interactive. Idempotent — only runs
// when the `area` table is empty.
const seedResult = ensureSeeded();
if (seedResult.seeded) {
  console.log('[boot] auto-seeded empty database:', seedResult.counts);
}

export const handle: Handle = async ({ event, resolve }) => {
  const cookieValue = event.cookies.get(PERSONA_COOKIE);
  const persona = findPersona(cookieValue) ?? findPersona(DEFAULT_PERSONA_ID) ?? PERSONAS[0];
  event.locals.persona = persona;
  return resolve(event);
};
