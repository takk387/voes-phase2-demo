<script lang="ts">
  import type { PageData } from './$types';
  interface Props { data: PageData; }
  let { data }: Props = $props();

  interface Report {
    href: string;
    name: string;
    description: string;
    spec: string;
    audience: string;
  }

  const reports: Report[] = [
    {
      href: '/reports/compliance',
      name: 'Compliance summary',
      description: 'Per-area health check: cycle integrity, escalations following Procedure E, bypass remedies within window, audit hash chain unbroken. Print-ready for Joint Committee sign-off.',
      spec: '§15.2 / §2 (CBA traceability)',
      audience: 'Joint Committee, Plant Mgmt, Union'
    },
    {
      href: '/reports/fairness',
      name: 'Fairness distribution',
      description: 'Distribution of opportunities (interim) or hours offered (final) across active TMs in each area. Areas with deviations exceeding 10% are flagged.',
      spec: '§15.3 + §22.17 union round 1 default',
      audience: 'Joint Committee, Union, Plant Mgmt'
    },
    {
      href: '/reports/qualifications',
      name: 'Qualification gap',
      description: 'Ratio of qualified TMs to qualification-required posting volume per area. Surfaces capacity constraints for Joint Training Committee planning.',
      spec: '§15.4',
      audience: 'Joint Training Committee, Plant Mgmt'
    },
    {
      href: '/reports/flex',
      name: 'Flex day usage',
      description: 'Mandatory Flex-day count per shift against the 24-day annual cap (PS-004A). Voluntary OT is excluded per round 1 union feedback (§22.10).',
      spec: 'PS-004A + §22.10',
      audience: 'Joint Committee, Plant Mgmt, Union'
    }
  ];
</script>

<div class="space-y-6">
  <div>
    <h1 class="text-2xl font-semibold">Reports</h1>
    <p class="text-sm text-ink-600 mt-0.5">
      Standard reports per Phase 1 plan §15. Reports are read-only and surface
      patterns; they don't modify equalization state.
    </p>
  </div>

  <div class="grid sm:grid-cols-2 gap-4">
    {#each reports as r}
      <a href={r.href} class="card hover:border-accent-300 hover:ring-1 hover:ring-accent-200 transition-all">
        <div class="card-body space-y-2">
          <div class="flex items-baseline justify-between">
            <h2 class="font-semibold text-ink-900">{r.name}</h2>
            <span class="text-xs text-ink-500">{r.spec}</span>
          </div>
          <p class="text-sm text-ink-700">{r.description}</p>
          <p class="text-xs text-ink-500"><span class="uppercase tracking-wide">Audience:</span> {r.audience}</p>
        </div>
      </a>
    {/each}
  </div>

  <div class="card">
    <div class="card-body">
      <h2 class="font-medium text-sm mb-2">Audit log + grievance export</h2>
      <p class="text-sm text-ink-700">
        For a specific incident or pattern, pull the full audit trail and export
        a CSV grievance package.
      </p>
      <a href="/audit" class="btn-secondary mt-3 inline-block">Open audit log &rarr;</a>
    </div>
  </div>
</div>
