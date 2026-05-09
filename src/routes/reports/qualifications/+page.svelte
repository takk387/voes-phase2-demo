<script lang="ts">
  import type { PageData } from './$types';
  interface Props { data: PageData; }
  let { data }: Props = $props();
</script>

<div class="space-y-6">
  <div class="flex items-baseline justify-between">
    <div>
      <h1 class="text-2xl font-semibold">Qualification gap</h1>
      <p class="text-sm text-ink-600 mt-0.5">
        Per area, the ratio of qualified TMs to the volume of qualification-required
        postings. Surfaces capacity constraints for the Joint Training Committee.
      </p>
      <p class="text-xs text-ink-500 mt-1">
        Per §15.4 the report does not name individuals or recommend specific TMs
        for upskilling. It surfaces patterns; the Committee acts.
      </p>
    </div>
    <a href="/reports" class="text-sm text-accent-700 hover:underline">&larr; all reports</a>
  </div>

  {#each data.areas as a}
    <div class="card">
      <div class="card-header flex items-center justify-between">
        <span class="font-semibold">{a.area_name}</span>
        <span class="text-xs text-ink-500">{a.member_count} active TMs</span>
      </div>
      <div class="card-body p-0">
        {#if a.rows.length === 0}
          <p class="px-4 py-3 text-sm text-ink-500">No qualifications tracked or required in this area.</p>
        {:else}
          <table class="w-full text-sm table-zebra">
            <thead>
              <tr class="border-b border-ink-200 text-left">
                <th class="px-4 py-2 font-medium text-ink-600 text-xs uppercase">Qualification</th>
                <th class="px-4 py-2 font-medium text-ink-600 text-xs uppercase tabular text-right">Qualified TMs</th>
                <th class="px-4 py-2 font-medium text-ink-600 text-xs uppercase tabular text-right">Postings (30d)</th>
                <th class="px-4 py-2 font-medium text-ink-600 text-xs uppercase tabular text-right">Postings (lifetime)</th>
                <th class="px-4 py-2 font-medium text-ink-600 text-xs uppercase">Status</th>
              </tr>
            </thead>
            <tbody>
              {#each a.rows as r}
                <tr class="border-b border-ink-100 last:border-b-0">
                  <td class="px-4 py-2">{r.qualification_name}</td>
                  <td class="px-4 py-2 text-right tabular">{r.qualified_count}</td>
                  <td class="px-4 py-2 text-right tabular">{r.required_postings_30d}</td>
                  <td class="px-4 py-2 text-right tabular">{r.required_postings_lifetime}</td>
                  <td class="px-4 py-2 text-xs">
                    {#if r.flag === 'tight'}
                      <span class="badge-amber">tight</span>
                      <span class="text-ink-600 ml-1">
                        {#if r.qualified_count === 0}
                          no qualified TMs
                        {:else if r.ratio_30d !== null}
                          {r.qualified_count} qualified vs {r.required_postings_30d} required
                        {/if}
                      </span>
                    {:else if r.flag === 'no_demand'}
                      <span class="badge-gray">no demand</span>
                      <span class="text-ink-500 ml-1">no qual-required postings in last 30d</span>
                    {:else}
                      <span class="badge-green">ok</span>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>
    </div>
  {/each}

  <p class="text-xs text-ink-500">
    "Tight" means fewer qualified TMs than postings requiring the qualification
    in the last 30 days, or zero qualified TMs at all. The Joint Training
    Committee uses this to prioritize training investments.
  </p>
</div>
