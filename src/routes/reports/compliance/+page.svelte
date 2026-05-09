<script lang="ts">
  import type { PageData } from './$types';
  interface Props { data: PageData; }
  let { data }: Props = $props();

  const passCount = $derived(data.checks.filter((c) => c.pass).length);
  const failCount = $derived(data.checks.length - passCount);
</script>

<div class="space-y-6">
  <div class="flex items-baseline justify-between">
    <div>
      <h1 class="text-2xl font-semibold">Compliance summary</h1>
      <p class="text-sm text-ink-600 mt-0.5">
        Automated CBA-compliance checks. Each check is conservative — it flags
        FAIL only when non-compliance can be proved from data.
      </p>
    </div>
    <a href="/reports" class="text-sm text-accent-700 hover:underline">&larr; all reports</a>
  </div>

  <!-- Stats panel -->
  <div class="card">
    <div class="card-header">
      <span class="font-medium text-sm">Plant snapshot</span>
    </div>
    <div class="card-body grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
      <div>
        <div class="text-xs uppercase tracking-wide text-ink-500">Active areas</div>
        <div class="text-2xl font-semibold tabular">{data.stats.active_areas}<span class="text-base text-ink-400">/{data.stats.total_areas}</span></div>
      </div>
      <div>
        <div class="text-xs uppercase tracking-wide text-ink-500">Postings</div>
        <div class="text-2xl font-semibold tabular">{data.stats.total_postings}</div>
        <div class="text-xs text-ink-500">
          {data.stats.satisfied_postings} satisfied &middot;
          {data.stats.cancelled_postings} cancelled &middot;
          {data.stats.abandoned_postings} abandoned
        </div>
      </div>
      <div>
        <div class="text-xs uppercase tracking-wide text-ink-500">Responses</div>
        <div class="text-2xl font-semibold tabular">{data.stats.yes_responses + data.stats.no_responses}</div>
        <div class="text-xs text-ink-500">
          {data.stats.yes_responses} Yes &middot; {data.stats.no_responses} No
        </div>
      </div>
      <div>
        <div class="text-xs uppercase tracking-wide text-ink-500">Audit entries</div>
        <div class="text-2xl font-semibold tabular">{data.stats.total_audit_entries}</div>
      </div>
      <div>
        <div class="text-xs uppercase tracking-wide text-ink-500">Open remedies</div>
        <div class="text-2xl font-semibold tabular">{data.stats.open_bypass_remedies}</div>
      </div>
      <div>
        <div class="text-xs uppercase tracking-wide text-ink-500">In-flight escalations</div>
        <div class="text-2xl font-semibold tabular">{data.stats.open_escalations}</div>
      </div>
    </div>
  </div>

  <!-- Checklist -->
  <div class="card">
    <div class="card-header flex items-center justify-between">
      <span class="font-medium text-sm">CBA compliance checks</span>
      <span class="text-xs">
        {#if failCount === 0}
          <span class="badge-green">{passCount} / {data.checks.length} passing</span>
        {:else}
          <span class="badge-red">{failCount} failing</span>
        {/if}
      </span>
    </div>
    <div class="card-body p-0">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-ink-200 text-left">
            <th class="px-4 py-2 font-medium text-ink-600 text-xs uppercase w-20">Status</th>
            <th class="px-4 py-2 font-medium text-ink-600 text-xs uppercase">Check</th>
            <th class="px-4 py-2 font-medium text-ink-600 text-xs uppercase">CBA reference</th>
            <th class="px-4 py-2 font-medium text-ink-600 text-xs uppercase">Detail</th>
          </tr>
        </thead>
        <tbody>
          {#each data.checks as c}
            <tr class="border-b border-ink-100 last:border-b-0">
              <td class="px-4 py-3">
                {#if c.pass}<span class="badge-green">pass</span>{:else}<span class="badge-red">fail</span>{/if}
              </td>
              <td class="px-4 py-3">
                <div class="font-medium text-ink-900">{c.name}</div>
              </td>
              <td class="px-4 py-3 text-xs text-ink-600">{c.cba_ref}</td>
              <td class="px-4 py-3 text-xs text-ink-700">{c.detail}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>

  <p class="text-xs text-ink-500">
    This summary is auto-generated. Sign-off by the Joint Committee is a
    separate workflow (a printed export of this page with signatures from
    Plant Mgmt and Union Chairperson).
  </p>
</div>
