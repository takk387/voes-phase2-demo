import type { Handle } from '@sveltejs/kit';
import { DEFAULT_PERSONA_ID, findPersona, PERSONAS } from '$lib/personas';

const PERSONA_COOKIE = 'voes_persona';

export const handle: Handle = async ({ event, resolve }) => {
  const cookieValue = event.cookies.get(PERSONA_COOKIE);
  const persona = findPersona(cookieValue) ?? findPersona(DEFAULT_PERSONA_ID) ?? PERSONAS[0];
  event.locals.persona = persona;
  return resolve(event);
};
