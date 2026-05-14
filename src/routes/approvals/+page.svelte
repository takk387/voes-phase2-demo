<script lang="ts">
  import type { ActionData, PageData } from './$types';
  import { enhance } from '$app/forms';

  interface Props { data: PageData; form?: ActionData; }
  let { data, form }: Props = $props();

  function actionLabel(t: string): string {
    switch (t) {
      case 'mode_cutover': return 'Mode cutover (interim → final)';
      case 'annual_zero_out': return 'Annual zero-out';
      case 'area_split': return 'Area split';
      case 'area_merge': return 'Area merge';
      case 'area_retire': return 'Area retirement';
      default: return t;
    }
  }

  function fmt(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  }
</script>

<div class="space-y-6">
  <div>
    <h1 class="text-2xl font-semibold">Dual-approval queue</h1>
    <p class="text-sm text-ink-600 mt-0.5">
      High-impact actions (mode cutover, annual zero-out, structural changes)
      require both Plant Management and Union sign-off before executing
      (§3.7).
    </p>
  </div>

  {#if form?.error}
    <div class="bg-red-50 border border-red-200 text-red-800 text-sm rounded p-3">{form.error}</div>
  {/if}

  <div class="card">
    <div class="card-header flex items-center justify-between">
      <span class="font-medium text-sm">Pending</span>
      <span class="text-xs text-ink-500">{data.pending.length} waiting</span>
    </div>
    <div class="card-body space-y-3">
      {#if data.pending.length === 0}
        <p class="text-sm text-ink-600">No actions awaiting approval.</p>
      {:else}
        {#each data.pending as p}
          <div class="border border-ink-200 rounded p-3">
            <div class="flex items-baseline justify-between mb-1">
              <span class="font-medium">{actionLabel(p.action_type)}</span>
              <span class="text-xs text-ink-500">initiated {fmt(p.initiated_at)} by {p.initiated_by_user}</span>
            </div>
            <div class="text-sm text-ink-700">
              Scope: <span class="font-mono text-xs">{p.scope}</span>
              {#if p.area_name}<span class="text-ink-500">— {p.area_name}</span>{/if}
            </div>
            {#if p.payload}
              <div class="text-xs text-ink-600 mt-1">
                {JSON.stringify(p.payload)}
              </div>
            {/if}

            <div class="mt-3 grid grid-cols-2 gap-3 text-sm">
              <!-- Company side -->
              <div class="border border-ink-100 rounded p-2 {p.approved_company_user ? 'bg-emerald-50/50' : ''}">
                <div class="text-xs uppercase tracking-wide text-ink-500">Company side</div>
                {#if p.approved_company_user}
                  <div class="mt-1">
                    <span class="badge-green">approved</span>
                  </div>
                  <div class="text-xs text-ink-600 mt-1">
                    by {p.approved_company_user} &middot; {fmt(p.approved_company_at)}
                  </div>
                {:else}
                  <div class="mt-1 text-xs text-ink-600">awaiting Plant Management</div>
                  {#if data.role === 'plant_manager'}
                    <form method="POST" action="?/approve" use:enhance class="mt-2">
                      <input type="hidden" name="approval_id" value={p.id} />
                      <input type="hidden" name="side" value="company" />
                      <button class="btn-primary text-xs px-3 py-1.5" type="submit">Approve as Plant Mgmt</button>
                    </form>
                  {/if}
                {/if}
              </div>
              <!-- Union side -->
              <div class="border border-ink-100 rounded p-2 {p.approved_union_user ? 'bg-emerald-50/50' : ''}">
                <div class="text-xs uppercase tracking-wide text-ink-500">Union side</div>
                {#if p.approved_union_user}
                  <div class="mt-1">
                    <span class="badge-green">approved</span>
                  </div>
                  <div class="text-xs text-ink-600 mt-1">
                    by {p.approved_union_user} &middot; {fmt(p.approved_union_at)}
                  </div>
                {:else}
                  <div class="mt-1 text-xs text-ink-600">awaiting Union Representative</div>
                  {#if data.role === 'union_rep'}
                    <form method="POST" action="?/approve" use:enhance class="mt-2">
                      <input type="hidden" name="approval_id" value={p.id} />
                      <input type="hidden" name="side" value="union" />
                      <button class="btn-primary text-xs px-3 py-1.5" type="submit">Approve as Union</button>
                    </form>
                  {/if}
                {/if}
              </div>
            </div>
          </div>
        {/each}
      {/if}
    </div>
  </div>

  {#if data.recent.length > 0}
    <div class="card">
      <div class="card-header">
        <span class="font-medium text-sm">Recent</span>
      </div>
      <div class="card-body">
        <ul class="text-sm space-y-1">
          {#each data.recent as r}
            <li class="flex items-center justify-between py-1 border-b border-ink-100 last:border-b-0">
              <span>
                {actionLabel(r.action_type)}
                {#if r.area_name}— {r.area_name}{/if}
              </span>
              <span>
                {#if r.status === 'executed'}<span class="badge-green">executed</span>
                {:else if r.status === 'cancelled'}<span class="badge-gray">cancelled</span>
                {/if}
                <span class="text-xs text-ink-500 ml-2">{fmt(r.executed_at ?? r.cancelled_at ?? r.initiated_at)}</span>
              </span>
            </li>
          {/each}
        </ul>
      </div>
    </div>
  {/if}
</div>
