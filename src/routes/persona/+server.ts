// Persona switch endpoint. Sets the cookie and redirects back to home.
// Logs the switch to the audit log so the demo's behavior is fully traceable.

import type { RequestHandler } from './$types';
import { redirect } from '@sveltejs/kit';
import { findPersona } from '$lib/personas';
import { writeAudit } from '$lib/server/audit';

export const POST: RequestHandler = async ({ request, cookies, locals }) => {
  const form = await request.formData();
  const personaId = form.get('persona_id');

  if (typeof personaId !== 'string' || !findPersona(personaId)) {
    redirect(303, '/');
  }

  cookies.set('voes_persona', personaId, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30
  });

  writeAudit({
    actor_user: locals.persona.id,
    actor_role: locals.persona.role,
    action: 'demo_persona_switch',
    data: { from: locals.persona.id, to: personaId }
  });

  redirect(303, '/');
};
