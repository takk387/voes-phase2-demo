<script lang="ts">
  import type { PageData } from './$types';
  interface Props { data: PageData; }
  let { data }: Props = $props();

  function pct(n: number): string {
    return n.toFixed(1) + '%';
  }
</script>

<div class="space-y-6">
  <div>
    <h1 class="text-2xl font-semibold">Fairness report</h1>
    <p class="text-sm text-ink-600 mt-0.5">
      Distribution of opportunities (interim mode) or hours offered (final
      mode) across active TMs in each area. Areas with deviations exceeding
      <span class="font-medium">{data.threshold_pct}%</span> are flagged for review.
    </p>
    <p class="text-xs text-ink-500 mt-1">
      Reports surface patterns; they don't assert unfairness.
    </p>
  </div>

  {#if data.areas.length === 0}
    <div class="card">
      <div class="card-body">
        <p class="text-sm text-ink-600">No areas in your jurisdiction.</p>
      </div>
    </div>
  {/if}

  {#each data.areas as a}
    <div class="card {a.flagged ? 'border-amber-300 ring-1 ring-amber-200' : ''}">
      <div class="card-header flex items-center justify-between">
        <div>
          <span class="font-semibold">{a.name}</span>
          <span class="ml-3 text-xs text-ink-500">{a.mode} mode &middot; {a.count} active TMs</span>
        </div>
        <div class="flex items-center gap-2">
          {#if a.flagged}
            <span class="badge-amber">flagged ({pct(a.max_dev_pct)} max deviation)</span>
          {:else if a.count > 0}
            <span class="badge-green">within tolerance</span>
          {:else}
            <span class="badge-gray">no data</span>
          {/if}
        </div>
      </div>
      <div class="card-body">
        {#if a.count === 0}
          <p class="text-sm text-ink-500">No active members.</p>
        {:else}
          <div class="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-4">
            <div>
              <div class="text-xs uppercase tracking-wide text-ink-500">Measure</div>
              <div class="text-sm font-medium">{a.measure_label}</div>
            </div>
            <div>
              <div class="text-xs uppercase tracking-wide text-ink-500">Mean</div>
              <div class="text-2xl font-semibold tabular">{a.mean}</div>
            </div>
            <div>
              <div class="text-xs uppercase tracking-wide text-ink-500">Min</div>
              <div class="text-2xl font-semibold tabular">{a.min}</div>
            </div>
            <div>
              <div class="text-xs uppercase tracking-wide text-ink-500">Max</div>
              <div class="text-2xl font-semibold tabular">{a.max}</div>
            </div>
            <div>
              <div class="text-xs uppercase tracking-wide text-ink-500">Max deviation</div>
              <div class="text-2xl font-semibold tabular {a.flagged ? 'text-amber-700' : ''}">{pct(a.max_dev_pct)}</div>
              <div class="text-xs text-ink-500">vs mean</div>
            </div>
          </div>

          <details class="text-sm">
            <summary class="cursor-pointer text-ink-700 hover:text-ink-900">
              Per-TM detail ({a.count} rows)
            </summary>
            <div class="mt-3 border border-ink-200 rounded">
              <table class="w-full text-sm table-zebra">
                <thead>
                  <tr class="border-b border-ink-200 text-left">
                    <th class="px-3 py-2 font-medium text-ink-600 text-xs uppercase">Team Member</th>
                    <th class="px-3 py-2 font-medium text-ink-600 text-xs uppercase">Hire</th>
                    <th class="px-3 py-2 font-medium text-ink-600 text-xs uppercase tabular text-right">{a.measure_label}</th>
                    <th class="px-3 py-2 font-medium text-ink-600 text-xs uppercase tabular text-right">Δ vs mean</th>
                  </tr>
                </thead>
                <tbody>
                  {#each a.members as m}
                    {@const dev = m.measure - a.mean}
                    {@const devPct = a.mean > 0 ? (Math.abs(dev) / a.mean) * 100 : 0}
                    <tr class="border-b border-ink-100 last:border-b-0">
                      <td class="px-3 py-1.5">{m.display_name}</td>
                      <td class="px-3 py-1.5 text-ink-600 text-xs tabular">{m.hire_date}</td>
                      <td class="px-3 py-1.5 text-right tabular">{m.measure}</td>
                      <td class="px-3 py-1.5 text-right tabular {devPct > a.threshold_pct ? 'text-amber-700 font-medium' : 'text-ink-500'}">
                        {dev > 0 ? '+' : ''}{Math.round(dev * 10) / 10} ({pct(devPct)})
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          </details>
        {/if}
      </div>
    </div>
  {/each}

  <p class="text-xs text-ink-500">
    These reports compare to the area's own mean. Cross-area comparison and
    trend analysis are roadmap items. Reports are read-only; they don't
    modify equalization state.
  </p>
</div>
