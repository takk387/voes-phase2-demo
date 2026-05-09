# VOES — Phase 2 working demonstration

A working prototype of a CBA-compliant Voluntary Overtime Equalization System
for a UAW-organized manufacturing plant. This is the Phase 2 deliverable of a
three-phase project; Phase 1 was the detailed specification, Phase 3 will be
the reference implementation.

This prototype is for stakeholder buy-in — it exercises every major flow the
production system would handle, against synthetic data, with a multi-role
persona switcher so reviewers can see the system from each angle in a single
session.

## Running locally

```sh
npm install
npm run seed     # populate data/voes-demo.db with synthetic data
npm run dev      # http://localhost:5173
```

Default persona is Adams (Team Member, BA2 1st shift). Switch personas via the
header dropdown.

For a guided walkthrough, visit `/walkthrough` once the server is up — or
read [WALKTHROUGH.md](./WALKTHROUGH.md) directly.

## What's covered

- **Two equalization modes** — interim (opportunity-based) and final
  (hours-based), with the cutover from one to the other as a defined
  dual-approval event
- **Multi-role views** — Team Member, Supervisor, Union Representative,
  Plant Manager, Admin (11 personas total)
- **Bypass remedy** — when a TM is skipped in error, they're queued for the
  next eligible offer ahead of normal rotation (CBA next-available-remedy
  rule, not pay)
- **Mandatory escalation** — Procedure E (ask-high then force-low) for
  critical OT, with a separate non-essential branch (cascade to adjacent
  units, then abandon) per round-1 union feedback
- **Dual approval** — high-impact actions (mode cutover, annual zero-out,
  area split / merge / retire) require independent Plant Mgmt and Union
  sign-off before executing
- **Audit log** — append-only, hash-chained, role-scoped, with CSV export
  for grievance support
- **Reports** — auto-generated compliance summary, fairness distribution,
  qualification gap, Flex day usage

## Stack

- SvelteKit 2 + Svelte 5
- TypeScript
- SQLite via `better-sqlite3` (locally) — see [DEPLOYMENT.md](./DEPLOYMENT.md)
  for serverless / Turso path
- Tailwind 3

## Files

```
src/lib/server/
├── schema.sql          # full data model (~20 tables)
├── seed.ts             # synthetic data: 4 areas, 44 TMs (Appendix C cast)
├── rotation.ts         # Procedures A (interim) and B (final) + areaStanding
├── offers.ts           # offer lifecycle + final-mode charges + remedy hooks
├── remedies.ts         # bypass remedy precedence and lifecycle
├── escalation.ts       # Procedure E + §22.1 non-essential cascade
├── cutover.ts          # Procedure D + zero-out + dual-approval queue
├── structural.ts       # area split / merge / retire
├── compliance.ts       # 8 CBA-fidelity invariant checks
└── audit.ts            # hash-chained audit log

src/routes/
├── tm/                 # Team Member dashboard, area list, offer detail
├── sv/                 # Supervisor dashboard, post, rotation runner, bypass
├── admin/              # Cutover / zero-out / structural-action initiation
├── approvals/          # Dual-approval queue
├── audit/              # Log + CSV grievance export
├── reports/            # compliance / fairness / qualifications / flex
├── demo/reset/         # POST endpoint to wipe and re-seed
└── walkthrough/        # Rendered WALKTHROUGH.md
```

## Demo notes

Synthetic data only. Not for production use. The system is technology-neutral
at the specification level (Phase 1); this prototype picks a stack to make
the demo runnable but is not the production blueprint.

CBA citations are surfaced inline (rotation runner cites Procedure A or B,
compliance summary cites §s, etc.) so reviewers can trace any system behavior
back to its contractual basis.

## License

The Phase 2 prototype is delivered through the company ideas program. The
receiving organization holds whatever rights the program grants it. The
originator does not retain ongoing rights or assert separate copyright that
would constrain the company's use.
