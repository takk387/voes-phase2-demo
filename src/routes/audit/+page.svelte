<script lang="ts">
  import type { PageData } from './$types';
  interface Props { data: PageData; }
  let { data }: Props = $props();

  function formatTs(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'medium' });
  }

  function actionColor(action: string): string {
    if (action.includes('charge')) return 'badge-blue';
    if (action.includes('cancel') || action.includes('reverse')) return 'badge-amber';
    if (action.includes('satisfied') || action.includes('granted')) return 'badge-green';
    if (action.includes('skip') || action.includes('passed')) return 'badge-gray';
    if (action.includes('demo')) return 'badge-amber';
    return 'badge-gray';
  }

  function shortHash(h: string | null): string {
    if (!h) return '';
    return h.replace('sha256:', '').slice(0, 8);
  }

  let expandedId = $state<number | null>(null);
  function toggle(id: number) {
    expandedId = expandedId === id ? null : id;
  }

  function prettyData(json: string | null): string {
    if (!json) return '';
    try { return JSON.stringify(JSON.parse(json), null, 2); }
    catch { return json; }
  }
</script>

<div class="space-y-4">
  <div class="flex items-baseline justify-between">
    <div>
      <h1 class="text-2xl font-semibold">Audit log</h1>
      <p class="text-sm text-ink-600 mt-0.5">
        Append-only, hash-chained record of every system action. Read access scoped
        to your role and jurisdiction.
      </p>
    </div>
    <a href="/reports/fairness" class="text-sm text-accent-700 hover:underline">Fairness report &rarr;</a>
  </div>

  <div class="card">
    <div class="card-body">
      <form method="GET" class="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-4 pb-4 border-b border-ink-200">
        <div>
          <label for="area" class="label text-xs">Area</label>
          <select id="area" name="area" class="input">
            <option value="">All areas</option>
            {#each data.visibleAreas as a}
              <option value={a.id} selected={a.id === data.filterArea}>{a.name}</option>
            {/each}
          </select>
        </div>
        <div>
          <label for="employee" class="label text-xs">Employee ID</label>
          <input id="employee" name="employee" class="input" value={data.filterEmp ?? ''} placeholder="e.g. emp-adams-r" />
        </div>
        <div>
          <label for="action" class="label text-xs">Action</label>
          <select id="action" name="action" class="input">
            <option value="">All actions</option>
            {#each data.actionTypes as a}
              <option value={a} selected={a === data.filterAction}>{a}</option>
            {/each}
          </select>
        </div>
        <div class="flex items-end gap-2">
          <button type="submit" class="btn-primary text-xs">Filter</button>
          <a href="/audit" class="btn-secondary text-xs">Clear</a>
        </div>
      </form>

      <div class="flex items-center justify-between mb-3 -mt-3">
        <div class="text-xs text-ink-500">
          {data.entries.length} entries shown
        </div>
        <a
          class="text-xs text-accent-700 hover:underline"
          href={`/audit/export.csv${[
            data.filterArea ? `area=${data.filterArea}` : '',
            data.filterEmp ? `employee=${data.filterEmp}` : '',
            data.filterAction ? `action=${data.filterAction}` : ''
          ].filter(Boolean).length > 0 ? '?' + [
            data.filterArea ? `area=${data.filterArea}` : '',
            data.filterEmp ? `employee=${data.filterEmp}` : '',
            data.filterAction ? `action=${data.filterAction}` : ''
          ].filter(Boolean).join('&') : ''}`}
        >
          Export CSV (grievance package) &darr;
        </a>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-sm table-zebra">
          <thead>
            <tr class="border-b border-ink-200 text-left">
              <th class="px-2 py-2 font-medium text-ink-600 text-xs uppercase w-32">Time</th>
              <th class="px-2 py-2 font-medium text-ink-600 text-xs uppercase">Actor</th>
              <th class="px-2 py-2 font-medium text-ink-600 text-xs uppercase">Action</th>
              <th class="px-2 py-2 font-medium text-ink-600 text-xs uppercase">Affected</th>
              <th class="px-2 py-2 font-medium text-ink-600 text-xs uppercase">Hash</th>
            </tr>
          </thead>
          <tbody>
            {#each data.entries as e}
              <tr class="border-b border-ink-100 last:border-b-0 align-top">
                <td class="px-2 py-2 text-xs text-ink-700 font-mono whitespace-nowrap">
                  {formatTs(e.ts)}
                </td>
                <td class="px-2 py-2">
                  <div class="text-xs">{e.actor_user}</div>
                  <div class="text-xs text-ink-500">{e.actor_role}</div>
                </td>
                <td class="px-2 py-2">
                  <span class={actionColor(e.action)}>{e.action}</span>
                  {#if e.reason}
                    <div class="text-xs text-ink-500 italic mt-1">{e.reason}</div>
                  {/if}
                </td>
                <td class="px-2 py-2 text-xs text-ink-600">
                  {#if e.area_id}<div>area: <span class="font-mono">{e.area_id}</span></div>{/if}
                  {#if e.employee_id}<div>emp: <span class="font-mono">{e.employee_id}</span></div>{/if}
                  {#if e.posting_id}<div>posting: <span class="font-mono">{e.posting_id}</span></div>{/if}
                  {#if e.offer_id}<div>offer: <span class="font-mono">{e.offer_id}</span></div>{/if}
                  {#if e.data_json}
                    <button class="text-accent-700 underline text-xs mt-1" onclick={() => toggle(e.id)}>
                      {expandedId === e.id ? 'hide' : 'show'} data
                    </button>
                    {#if expandedId === e.id}
                      <pre class="mt-1 p-2 bg-ink-100 rounded text-xs whitespace-pre-wrap break-all">{prettyData(e.data_json)}</pre>
                    {/if}
                  {/if}
                </td>
                <td class="px-2 py-2 text-xs font-mono text-ink-500" title={e.entry_hash ?? ''}>
                  {shortHash(e.entry_hash)}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if data.entries.length === 0}
          <p class="text-sm text-ink-500 py-6 text-center">No entries match the current filter.</p>
        {/if}
      </div>

      <p class="text-xs text-ink-500 mt-3">
        Showing newest 500 entries. Each entry's hash chains to the previous one;
        modifying any past entry would break the chain. (§16.3 audit immutability.)
      </p>
    </div>
  </div>
</div>
