<script lang="ts">
  import type { PageData } from './$types';
  interface Props { data: PageData; }
  let { data }: Props = $props();

  function formatDate(iso: string): string {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  function multiplierLabel(m: number): string {
    if (m === 1.5) return '1.5×';
    if (m === 2.0) return '2.0×';
    return '1.0×';
  }
</script>

<div class="space-y-6">
  <div class="flex items-baseline justify-between">
    <div>
      <h1 class="text-2xl font-semibold">
        {data.isSTSupervisor ? 'Skilled Trades supervisor' : 'Supervisor'} dashboard
      </h1>
      <p class="text-sm text-ink-600 mt-0.5">
        {data.isSTSupervisor ? 'Your dedicated Skilled Trades area.' : 'Areas you supervise.'}
      </p>
    </div>
    {#if !data.isSTSupervisor}
      <a href="/sv/bypass" class="text-sm text-accent-700 hover:underline">Flag bypass &rarr;</a>
    {/if}
  </div>

  <!-- ST SV approval banner: pending postings awaiting this SV's approval. -->
  {#if data.isSTSupervisor && data.stPendingApprovals.length > 0}
    <div class="card border-amber-300 ring-1 ring-amber-200">
      <div class="card-header bg-amber-50/80 flex items-center justify-between">
        <span class="font-medium text-sm">
          {data.stPendingApprovals.length}
          posting{data.stPendingApprovals.length === 1 ? '' : 's'} pending your approval
        </span>
        <a href="/sv/approvals" class="btn-primary text-xs px-3 py-1.5">Open approval queue →</a>
      </div>
      <div class="card-body">
        <ul class="text-sm divide-y divide-ink-100">
          {#each data.stPendingApprovals as p}
            <li class="py-2 flex items-center justify-between">
              <div>
                <span class="font-medium">{p.area_name}</span>
                <span class="text-xs text-ink-600 ml-2">
                  {formatDate(p.work_date)} &middot; {p.start_time} &middot;
                  {p.duration_hours}h &middot; {multiplierLabel(p.pay_multiplier)}
                </span>
                {#if p.required_classification}
                  <span class="text-xs text-ink-700 ml-1">&middot; {p.required_classification}</span>
                {:else if p.required_expertise}
                  <span class="text-xs text-ink-700 ml-1">&middot; any {p.required_expertise}</span>
                {/if}
              </div>
              <a href="/sv/approvals" class="text-xs text-accent-700 hover:underline">review →</a>
            </li>
          {/each}
        </ul>
      </div>
    </div>
  {/if}

  {#if data.openRemedies.length > 0}
    <div class="card border-amber-300 ring-1 ring-amber-200">
      <div class="card-header bg-amber-50/80 flex items-center justify-between">
        <span class="font-medium text-sm">Open bypass remedies ({data.openRemedies.length})</span>
        <a href="/sv/bypass" class="text-xs text-accent-700 hover:underline">Manage</a>
      </div>
      <div class="card-body">
        <p class="text-xs text-ink-700 mb-2">
          The next eligible offer in each affected area where the TM qualifies will go to them ahead of normal rotation.
        </p>
        <ul class="text-sm divide-y divide-ink-100">
          {#each data.openRemedies as r}
            <li class="py-2 flex items-baseline justify-between gap-3">
              <span><span class="font-medium">{r.affected_employee_name}</span> &middot; <span class="text-ink-600 text-xs">{r.area_name}</span></span>
              <span class="text-xs text-ink-500 italic truncate max-w-md text-right">{r.cause ?? ''}</span>
            </li>
          {/each}
        </ul>
      </div>
    </div>
  {/if}

  {#if !data.isSTSupervisor}
  {#each data.areas as area}
    {#if area}
    <div class="card">
      <div class="card-header flex items-center justify-between">
        <div>
          <span class="font-semibold">{area.name}</span>
          <span class="ml-3 text-xs text-ink-500">{area.mode} mode &middot; cycle {area.cycle} &middot; {area.memberCount} TMs</span>
        </div>
        <a href="/sv/post?area={area.id}" class="btn-primary text-xs px-3 py-1.5">Post new opportunity</a>
      </div>
      <div class="card-body space-y-4">
        <div>
          <div class="text-xs uppercase tracking-wide text-ink-500 mb-2">Open postings ({area.openPostings.length})</div>
          {#if area.openPostings.length === 0}
            <p class="text-sm text-ink-600">None — area is up to date.</p>
          {:else}
            <ul class="divide-y divide-ink-100 border border-ink-200 rounded">
              {#each area.openPostings as p}
                <li class="px-3 py-2 flex items-center justify-between">
                  <div>
                    <div class="text-sm font-medium">
                      {p.duration_hours}-hour {p.ot_type.replace('voluntary_','').replace('_',' ')}
                    </div>
                    <div class="text-xs text-ink-600">
                      {formatDate(p.work_date)} &middot; {p.start_time} &middot; {p.yes_count}/{p.volunteers_needed} filled
                      {#if p.criticality === 'non_essential'}
                        &middot; <span class="badge-gray">non-essential</span>
                      {/if}
                    </div>
                  </div>
                  <a href="/sv/posting/{p.id}" class="btn-secondary text-xs px-3 py-1.5">Run rotation</a>
                </li>
              {/each}
            </ul>
          {/if}
        </div>

        <div>
          <div class="text-xs uppercase tracking-wide text-ink-500 mb-2">Recently completed</div>
          {#if area.recentlyCompleted.length === 0}
            <p class="text-sm text-ink-600">No history yet.</p>
          {:else}
            <ul class="divide-y divide-ink-100 border border-ink-200 rounded">
              {#each area.recentlyCompleted as p}
                <li class="px-3 py-2 flex items-center justify-between text-sm">
                  <span>
                    {formatDate(p.work_date)} &middot; {p.duration_hours}-hour
                  </span>
                  <span class="text-xs">
                    {#if p.status === 'satisfied'}<span class="badge-green">satisfied</span>
                    {:else if p.status === 'cancelled'}<span class="badge-amber">cancelled</span>
                    {:else}<span class="badge-gray">{p.status}</span>{/if}
                    <a class="ml-2 text-accent-700 hover:underline" href="/sv/posting/{p.id}">view</a>
                  </span>
                </li>
              {/each}
            </ul>
          {/if}
        </div>

        <div class="flex gap-3">
          <a href="/tm/area?area={area.id}" class="text-sm text-accent-700 hover:underline">Area equalization list</a>
          <a href="/audit?area={area.id}" class="text-sm text-accent-700 hover:underline">Audit log</a>
        </div>
      </div>
    </div>
    {/if}
  {/each}
  {/if}

  {#if data.isSTSupervisor}
    {#each data.areas as area}
      {#if area}
        <div class="card">
          <div class="card-header">
            <span class="font-semibold">{area.name}</span>
            <span class="ml-2 badge-blue text-xs">Skilled Trades</span>
          </div>
          <div class="card-body space-y-2 text-sm">
            <p class="text-ink-700">
              {area.memberCount} members. Approvals come from the STAC Coordinator
              (Davis) and the SKT TL.
            </p>
            <div class="flex gap-3 text-xs">
              <a href="/tm/area?area={area.id}" class="text-accent-700 hover:underline">Equalization list</a>
              <a href="/audit?area={area.id}" class="text-accent-700 hover:underline">Audit log</a>
            </div>
          </div>
        </div>
      {/if}
    {/each}
  {/if}
</div>
