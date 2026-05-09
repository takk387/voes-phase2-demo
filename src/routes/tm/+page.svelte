<script lang="ts">
  import type { PageData } from './$types';

  interface Props { data: PageData; }
  let { data }: Props = $props();

  function formatDateTime(iso: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  }

  function formatDate(iso: string): string {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function responseLabel(t: string | null): { text: string; cls: string } {
    switch (t) {
      case 'yes': return { text: 'You said: YES', cls: 'badge-green' };
      case 'no': return { text: 'You said: NO', cls: 'badge-gray' };
      case 'on_leave': return { text: 'On leave (no charge)', cls: 'badge-amber' };
      case 'on_the_job': return { text: 'On the job (no charge)', cls: 'badge-amber' };
      case 'no_contact': return { text: 'No contact (no charge)', cls: 'badge-amber' };
      case 'passed_over_unqualified': return { text: 'Not qualified (no charge)', cls: 'badge-gray' };
      default: return { text: t ?? '—', cls: 'badge-gray' };
    }
  }
</script>

<div class="space-y-6">
  <div>
    <h1 class="text-2xl font-semibold text-ink-900">Hi, {data.employee.display_name.split(',')[0]}.</h1>
    <p class="text-sm text-ink-600 mt-0.5">
      Your overtime standing in <span class="font-medium">{data.area.area_name}</span>
    </p>
  </div>

  <!-- Open bypass remedy notice -->
  {#if data.openRemedies.length > 0}
    {#each data.openRemedies as r}
      <div class="card border-amber-300 ring-1 ring-amber-200">
        <div class="card-header bg-amber-50/80">
          <span class="font-medium text-sm">Bypass remedy queued for you</span>
        </div>
        <div class="card-body">
          <p class="text-sm text-ink-800">
            You're queued for the next eligible opportunity in <span class="font-medium">{r.area_name}</span>.
            Per CBA §5.14 / §10.17, the remedy is the next available assignment — not pay for the missed hours.
          </p>
          {#if r.cause}
            <p class="text-xs text-ink-600 italic mt-2">"{r.cause}"</p>
          {/if}
          <p class="text-xs text-ink-500 mt-2">
            Recorded {formatDateTime(r.recorded_at)} by {r.recorded_by_user}.
          </p>
        </div>
      </div>
    {/each}
  {/if}

  <!-- Pending offer -->
  {#if data.pendingOffers.length > 0}
    {#each data.pendingOffers as o}
      <div class="card border-accent-300 ring-1 ring-accent-200">
        <div class="card-header bg-accent-50/80">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="badge-blue">Action needed</span>
              <span class="text-sm font-medium text-ink-900">Pending offer</span>
            </div>
            <span class="text-xs text-ink-500">offered {formatDateTime(o.offered_at)}</span>
          </div>
        </div>
        <div class="card-body space-y-3">
          <div>
            <div class="text-lg font-semibold">{o.duration_hours}-hour {o.ot_type.replace('voluntary_','').replace('_',' ')}</div>
            <div class="text-sm text-ink-700">
              {formatDate(o.work_date)} &middot; starts {o.start_time}
            </div>
            {#if o.notes}
              <div class="text-xs text-ink-600 mt-1">{o.notes}</div>
            {/if}
          </div>
          <a href="/tm/offer/{o.offer_id}" class="btn-primary w-full sm:w-auto">
            Review and respond
          </a>
        </div>
      </div>
    {/each}
  {/if}

  <!-- Standing -->
  <div class="card">
    <div class="card-header flex items-center justify-between">
      <span class="font-medium text-sm">Your standing</span>
      <span class="text-xs text-ink-500">
        {#if data.area.mode === 'final'}
          final mode &middot; hours-based
        {:else}
          interim mode &middot; opportunity-based
        {/if}
      </span>
    </div>
    <div class="card-body">
      {#if data.area.mode === 'final'}
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <div class="text-xs uppercase tracking-wide text-ink-500">Position by seniority</div>
            <div class="text-2xl font-semibold tabular">
              {data.myStanding?.rotation_position ?? '—'} <span class="text-base text-ink-400">of {data.teamSize}</span>
            </div>
          </div>
          <div>
            <div class="text-xs uppercase tracking-wide text-ink-500">Hours offered</div>
            <div class="text-2xl font-semibold tabular">{data.myStanding?.hours_offered ?? 0}</div>
          </div>
          <div>
            <div class="text-xs uppercase tracking-wide text-ink-500">Hours accepted</div>
            <div class="text-2xl font-semibold tabular">{data.myStanding?.hours_accepted ?? 0}</div>
          </div>
          <div>
            <div class="text-xs uppercase tracking-wide text-ink-500">Hours worked</div>
            <div class="text-2xl font-semibold tabular">{data.myStanding?.hours_worked ?? 0}</div>
          </div>
        </div>
        <p class="text-xs text-ink-600 mt-3">
          The next opportunity goes to the qualified TM with the lowest hours offered.
          Saying No still consumes hours offered (PS-036) — it doesn't penalize you, but it
          counts as your turn at the rotation.
        </p>
      {:else}
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <div class="text-xs uppercase tracking-wide text-ink-500">Cycle</div>
            <div class="text-2xl font-semibold tabular">{data.cycle}</div>
          </div>
          <div>
            <div class="text-xs uppercase tracking-wide text-ink-500">Position</div>
            <div class="text-2xl font-semibold tabular">
              {data.myStanding?.rotation_position ?? '—'} <span class="text-base text-ink-400">of {data.teamSize}</span>
            </div>
          </div>
          <div>
            <div class="text-xs uppercase tracking-wide text-ink-500">This cycle</div>
            <div class="text-2xl font-semibold tabular">{data.myStanding?.cycle_charges ?? 0}</div>
            <div class="text-xs text-ink-500">opps offered</div>
          </div>
          <div>
            <div class="text-xs uppercase tracking-wide text-ink-500">Lifetime</div>
            <div class="text-2xl font-semibold tabular">{data.myStanding?.lifetime_charges ?? 0}</div>
            <div class="text-xs text-ink-500">opps offered</div>
          </div>
        </div>
      {/if}
      {#if data.myStanding?.qualifications.length}
        <div class="mt-4 flex items-center gap-2 flex-wrap">
          <span class="text-xs text-ink-500 uppercase tracking-wide">Quals:</span>
          {#each data.myStanding.qualifications as q}
            <span class="badge-blue">{q}</span>
          {/each}
        </div>
      {/if}
    </div>
  </div>

  <!-- Recent history -->
  <div class="card">
    <div class="card-header">
      <span class="font-medium text-sm">Recent offers</span>
    </div>
    <div class="card-body">
      {#if data.history.length === 0}
        <div class="text-sm text-ink-500">No offers yet.</div>
      {:else}
        <ul class="divide-y divide-ink-100">
          {#each data.history as h}
            {@const r = responseLabel(h.response_type)}
            <li class="py-2 flex items-center justify-between text-sm">
              <div>
                <div class="text-ink-900">
                  {formatDate(h.work_date)} &middot; {h.duration_hours}-hour {h.ot_type.replace('voluntary_','').replace('_',' ')}
                </div>
                <div class="text-xs text-ink-500">
                  {h.recorded_at ? 'recorded ' + formatDateTime(h.recorded_at) : ''}
                </div>
              </div>
              <span class="{r.cls}">{r.text}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>

  <div class="flex gap-3">
    <a href="/tm/area" class="btn-secondary">View full area equalization list</a>
    <a href="/audit?employee={data.employee.id}" class="btn-secondary">My audit history</a>
  </div>
</div>
