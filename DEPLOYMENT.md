# Deployment notes

The Phase 2 demo runs cleanly on local dev (`npm run dev`). Deploying it to a
shareable URL has one wrinkle worth understanding before pulling the trigger.

## The SQLite-on-serverless problem

Vercel (and most serverless platforms) execute each request in an ephemeral
function instance with a read-only or short-lived filesystem. The current
demo uses `better-sqlite3` against `data/voes-demo.db` — that works locally
because the file persists between requests, but on Vercel:

- The file at `/var/task/data/voes-demo.db` is read-only at runtime.
- Even if it weren't, each function instance is short-lived; writes don't
  carry across requests.
- The result: the demo would render initial state correctly but every
  click that mutates state (post, respond, approve, etc.) would either
  fail outright or appear to succeed but vanish on the next page load.

That's a confusing UX for a stakeholder walkthrough where the whole point
is clicking around.

## Three reasonable paths forward

### A. Turso (recommended)

[Turso](https://turso.tech/) hosts SQLite-compatible databases (libSQL)
designed for serverless. Free tier is plenty for a demo.

Steps:

1. Sign up at turso.tech, create a database (region close to you).
2. Get the DB URL and auth token.
3. Replace `better-sqlite3` with `@libsql/client` in `package.json` and
   `src/lib/server/db.ts`. The schema is identical; the API is similar.
4. Set `TURSO_URL` and `TURSO_AUTH_TOKEN` as Vercel environment variables.
5. Run the seed once (against the remote DB) before first use.
6. Deploy: `vercel --prod`. SvelteKit's `adapter-auto` picks up Vercel.

Effort: maybe 30–60 minutes including the driver swap. The schema doesn't
change.

### B. Vercel Postgres / Neon / Supabase

If the receiving organization already has a Postgres preference, convert
the schema (mostly straightforward — minor SQLite-isms in CHECK constraints
and `strftime` defaults). More involved than Turso but produces something
closer to a Phase 3 production posture.

### C. Don't deploy — share via screen-share or local install

Run `npm run dev` on your machine and screen-share for the walkthrough,
or have the reviewer install Node and run it locally (zero external
dependencies — the demo bundles its own seed). This sidesteps the
serverless-storage problem entirely and is the lowest-friction option
for a small reviewer audience.

## Recommendation

For a stakeholder demo at this stage, **option C** is the path of least
resistance. The reviewer audience (your union contact, a colleague, an
ideas-program reviewer) is small enough that screen-share or local
install works.

If the demo audience grows or you want a clickable URL to point at,
**option A (Turso)** is the cleanest upgrade. The driver swap is
isolated to `src/lib/server/db.ts`; no other code changes.

## Password gating (when you do deploy)

Since the demo carries synthetic data and shouldn't be indexed:

1. The `<meta name="robots" content="noindex,nofollow" />` is already in
   `app.html`.
2. Add a `vercel.json` with a basic-auth challenge or use a SvelteKit
   hook that checks `Authorization` against a single demo password from
   an env var.

For the Turso path, sketch:

```ts
// In src/hooks.server.ts, before the persona handler:
if (process.env.DEMO_PASSWORD) {
  const auth = event.request.headers.get('authorization') ?? '';
  const expected = 'Basic ' + btoa('demo:' + process.env.DEMO_PASSWORD);
  if (auth !== expected) {
    return new Response('Authentication required', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="VOES Demo"' }
    });
  }
}
```

Trivial; not worth wiring until deployment is decided.

## Adapter

The current `svelte.config.js` uses `@sveltejs/adapter-auto`, which
detects Vercel (and Netlify, Cloudflare, Node) at build time. Nothing
to change for the deploy itself; only the storage layer needs the
treatment described above.
