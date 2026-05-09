<script lang="ts">
  import type { PageData } from './$types';
  interface Props { data: PageData; }
  let { data }: Props = $props();

  function fmtDate(iso: string): string {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
</script>

<div class="space-y-6">
  <div class="flex items-baseline justify-between">
    <div>
      <h1 class="text-2xl font-semibold">Flex day usage &mdash; {data.year}</h1>
      <p class="text-sm text-ink-600 mt-0.5">
        Mandatory Flex-day count per shift against the {data.annual_cap}-day annual cap (PS-004A).
        Per round 1 union feedback (§22.10), voluntary OT is excluded from this count.
      </p>
    </div>
    <a href="/reports" class="text-sm text-accent-700 hover:underline">&larr; all reports</a>
  </div>

  <div class="card">
    <div class="card-header">
      <span class="font-medium text-sm">Per-shift usage</span>
    </div>
    <div class="card-body">
      {#if data.usage.length === 0}
        <p class="text-sm text-ink-500">No active shifts.</p>
      {:else}
        <div class="space-y-4">
          {#each data.usage as u}
            {@const pct = Math.min(100, (u.ytd_count / data.annual_cap) * 100)}
            <div>
              <div class="flex items-baseline justify-between mb-1">
                <span class="font-medium text-sm">{u.shift} shift</span>
                <span class="text-sm tabular">
                  {u.ytd_count} / {data.annual_cap}
                  <span class="text-ink-500 text-xs ml-2">{u.remaining} remaining</span>
                </span>
              </div>
              <div class="w-full h-3 bg-ink-100 rounded overflow-hidden relative">
                <div
                  class="h-full {u.status === 'red' ? 'bg-red-500' : u.status === 'amber' ? 'bg-amber-500' : 'bg-emerald-500'}"
                  style="width: {pct}%"
                ></div>
                <!-- Cap line at 100% -->
                <div class="absolute inset-y-0 right-0 w-px bg-ink-400"></div>
              </div>
              <div class="text-xs text-ink-500 mt-1">
                {#if u.status === 'red'}
                  At or past the {data.annual_cap}-day cap. Joint Committee action required.
                {:else if u.status === 'amber'}
                  Approaching cap. Surface in next Joint Committee meeting.
                {:else}
                  Within tolerance.
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>

  <div class="card">
    <div class="card-header flex items-center justify-between">
      <span class="font-medium text-sm">Mandatory Flex postings YTD</span>
      <span class="text-xs text-ink-500">since {data.year_start}</span>
    </div>
    <div class="card-body p-0">
      {#if data.recent.length === 0}
        <p class="px-4 py-3 text-sm text-ink-600">
          No mandatory Flex postings recorded YTD. (The seed has no mandatory_flex
          opportunities; in production these would post here.)
        </p>
      {:else}
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-ink-200 text-left">
              <th class="px-4 py-2 font-medium text-ink-600 text-xs uppercase">Date</th>
              <th class="px-4 py-2 font-medium text-ink-600 text-xs uppercase">Area</th>
              <th class="px-4 py-2 font-medium text-ink-600 text-xs uppercase">Shift</th>
              <th class="px-4 py-2 font-medium text-ink-600 text-xs uppercase">Status</th>
            </tr>
          </thead>
          <tbody>
            {#each data.recent as p}
              <tr class="border-b border-ink-100 last:border-b-0">
                <td class="px-4 py-2 tabular">{fmtDate(p.work_date)}</td>
                <td class="px-4 py-2"><a href="/sv/posting/{p.id}" class="text-accent-700 hover:underline">{p.area_name}</a></td>
                <td class="px-4 py-2">{p.shift}</td>
                <td class="px-4 py-2 text-xs">{p.status}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>
  </div>

  <p class="text-xs text-ink-500">
    Per §22.10 default: track and surface only — do not block scheduling.
    Joint Committee may adjust to "track and enforce" at any time.
  </p>
</div>
