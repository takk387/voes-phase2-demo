<script lang="ts">
  import type { ActionData, PageData } from './$types';
  import { enhance } from '$app/forms';

  interface Props { data: PageData; form?: ActionData; }
  let { data, form }: Props = $props();

  let unavailableReason = $state<string>('');

  function formatDate(iso: string): string {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  function formatDateTime(iso: string | null): string {
    if (!iso) return '';
    return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  }
  function responseLabel(t: string | null): { text: string; cls: string } {
    switch (t) {
      case 'yes': return { text: 'Yes', cls: 'badge-green' };
      case 'no': return { text: 'No', cls: 'badge-gray' };
      case 'on_leave': return { text: 'On leave (no charge)', cls: 'badge-amber' };
      case 'on_the_job': return { text: 'On the job (no charge)', cls: 'badge-amber' };
      case 'no_contact': return { text: 'No contact (no charge)', cls: 'badge-amber' };
      case 'passed_over_unqualified': return { text: 'Not qualified (no charge)', cls: 'badge-gray' };
      default: return { text: t ?? '—', cls: 'badge-gray' };
    }
  }
</script>

<div class="space-y-4">
  <a href="/sv" class="text-sm text-accent-700 hover:underline">&larr; back to dashboard</a>

  <!-- Posting summary header -->
  <div class="card">
    <div class="card-header flex items-center justify-between">
      <div>
        <span class="font-semibold">Posting {data.posting.id}</span>
        <span class="ml-3 text-xs text-ink-500">
          {data.posting.area_name}
        </span>
      </div>
      <span>
        {#if data.posting.status === 'open'}<span class="badge-blue">open</span>
        {:else if data.posting.status === 'satisfied'}<span class="badge-green">satisfied</span>
        {:else if data.posting.status === 'cancelled'}<span class="badge-amber">cancelled</span>
        {:else if data.posting.status === 'abandoned'}<span class="badge-gray">abandoned</span>
        {/if}
      </span>
    </div>
    <div class="card-body grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
      <div>
        <div class="text-xs text-ink-500 uppercase">Work date</div>
        <div class="font-medium">{formatDate(data.posting.work_date)}</div>
      </div>
      <div>
        <div class="text-xs text-ink-500 uppercase">Start &middot; duration</div>
        <div class="font-medium">{data.posting.start_time} &middot; {data.posting.duration_hours} hr</div>
      </div>
      <div>
        <div class="text-xs text-ink-500 uppercase">Filled / needed</div>
        <div class="font-medium tabular">{data.yes_count} / {data.posting.volunteers_needed}</div>
      </div>
      <div>
        <div class="text-xs text-ink-500 uppercase">Type &middot; criticality</div>
        <div class="font-medium text-xs">
          {data.posting.ot_type.replace('voluntary_','').replace('_',' ')} &middot; {data.posting.criticality.replace('_',' ')}
        </div>
      </div>
      {#if data.posting.notes}
        <div class="col-span-full">
          <div class="text-xs text-ink-500 uppercase">Notes</div>
          <div class="text-sm">{data.posting.notes}</div>
        </div>
      {/if}
      {#if data.requiredQuals.length > 0}
        <div class="col-span-full">
          <div class="text-xs text-ink-500 uppercase">Required quals</div>
          <div class="flex gap-2 flex-wrap mt-1">
            {#each data.requiredQuals as q}<span class="badge-blue">{q.name}</span>{/each}
          </div>
        </div>
      {/if}
    </div>
  </div>

  <!-- Pending offer / next-up card -->
  {#if data.posting.status === 'open' && data.pendingDetails}
    <div class="card {data.pendingRemedy ? 'border-amber-300 ring-1 ring-amber-200' : 'border-accent-300 ring-1 ring-accent-200'}">
      <div class="card-header {data.pendingRemedy ? 'bg-amber-50/80' : 'bg-accent-50/80'}">
        <div class="flex items-center justify-between">
          <span class="font-medium text-sm">
            {#if data.pendingRemedy}
              Bypass remedy &mdash; this offer takes precedence
            {:else}
              Next offer &mdash; awaiting your action
            {/if}
          </span>
          {#if data.pendingRemedy}
            <span class="badge-amber">remedy #{data.pendingRemedy.remedy_id}</span>
          {/if}
        </div>
      </div>
      <div class="card-body">
        <div class="border border-ink-200 rounded p-3 bg-white mb-4">
          <div class="flex items-baseline justify-between">
            <div>
              <span class="text-lg font-semibold">{data.pendingDetails.employee_name}</span>
              <span class="ml-3 text-xs text-ink-500">hire {data.pendingDetails.hire_date}</span>
            </div>
            <div class="text-xs text-ink-500 tabular">
              {#if data.mode === 'final'}
                hrs offered: {data.pendingDetails.hours_offered} &middot;
                accepted: {data.pendingDetails.hours_accepted} &middot;
                worked: {data.pendingDetails.hours_worked}
              {:else}
                cycle: {data.pendingDetails.cycle_charges} &middot; lifetime: {data.pendingDetails.lifetime_charges}
              {/if}
            </div>
          </div>
          {#if data.pendingDetails.qualifications.length}
            <div class="mt-2 flex gap-1 flex-wrap">
              {#each data.pendingDetails.qualifications as q}
                <span class="badge-gray text-xs">{q.replace(' certification','').replace(' cert','')}</span>
              {/each}
            </div>
          {/if}
          {#if data.pendingRemedy}
            <div class="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded px-3 py-2 mt-2">
              <div class="font-medium">Bypass remedy &mdash; ahead of normal rotation</div>
              <div class="mt-1">
                Recorded {new Date(data.pendingRemedy.recorded_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })} by {data.pendingRemedy.recorded_by_user}.
                {#if data.pendingRemedy.cause}<div class="italic mt-1">"{data.pendingRemedy.cause}"</div>{/if}
              </div>
              <div class="mt-1 text-ink-700">
                Per §5.14 the remedy is satisfied by offering the next available
                assignment — any response (Yes / No / skip) closes the remedy.
              </div>
            </div>
          {:else if data.mode === 'final'}
            <div class="text-xs text-ink-600 mt-2 italic">
              Selected by Procedure B (§9.2): lowest hours offered in the qualified pool, with seniority tie-break.{#if data.firstCycleAfterCutover} Currently in <span class="font-medium">first cycle after cutover</span> — offers go in seniority order until every member has been offered.{/if}
            </div>
          {/if}
        </div>

        <div class="text-xs text-ink-600 bg-ink-50 border border-ink-200 rounded px-3 py-2 mb-3 leading-relaxed">
          <span class="font-medium text-ink-800">{data.pendingDetails.employee_name.split(',')[0]} has been notified</span> &mdash;
          they can respond from the team-member app on their own. Use the buttons
          below only when recording a verbal response, marking unavailable, or
          when contact can't be made. The audit log records which path was used.
        </div>

        <form method="POST" action="?/respond" use:enhance class="space-y-3">
          <input type="hidden" name="offer_id" value={data.pendingDetails.offer_id} />

          <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <button class="btn-primary" name="response" value="yes" type="submit">Record YES (verbal)</button>
            <button class="btn-secondary" name="response" value="no" type="submit">Record NO (verbal)</button>
            <button class="btn-secondary" name="response" value="no_contact" type="submit"
                    onclick={() => unavailableReason = 'no contact'}>
              No contact
            </button>
          </div>

          <div class="border-t border-ink-200 pt-3">
            <div class="text-xs uppercase tracking-wide text-ink-500 mb-2">Mark unavailable (no charge)</div>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button class="btn-secondary text-xs" name="response" value="on_the_job" type="submit">On the job</button>
              <button class="btn-secondary text-xs" name="response" value="on_leave" type="submit">On approved leave</button>
              <button class="btn-secondary text-xs" name="response" value="passed_over_unqualified" type="submit">Qualification mismatch</button>
            </div>
          </div>

          <div>
            <label for="reason" class="label">Reason / note (optional)</label>
            <input id="reason" name="reason" class="input" placeholder="e.g. spoke at 5:10 AM, said yes verbally" />
          </div>

          {#if form?.error}
            <p class="text-sm text-red-700">{form.error}</p>
          {/if}
        </form>
      </div>
    </div>
  {:else if data.eligiblePoolExhausted}
    <div class="card border-amber-300 ring-1 ring-amber-200">
      <div class="card-header bg-amber-50/80 flex items-center justify-between">
        <span class="font-medium text-sm">
          Eligible pool exhausted &mdash; {data.posting.volunteers_needed - data.yes_count} short
        </span>
        {#if data.escalation}
          <span class="badge-amber">escalation #{data.escalation.id} {data.escalation.outcome.replace('_', ' ')}</span>
        {/if}
      </div>
      <div class="card-body space-y-3">
        {#if !data.escalation}
          <!-- Pre-escalation: show the right initiation button per criticality -->
          {#if data.posting.criticality === 'critical'}
            <p class="text-sm text-ink-800">
              <span class="font-medium">Critical OT.</span> Escalation will queue
              ask-high offers (remaining qualified TMs in seniority order, oldest
              first). If still short after ask-high, force-low becomes available.
            </p>
            <form method="POST" action="?/escalate" use:enhance>
              <button class="btn-primary" type="submit">Initiate mandatory escalation (ask-high)</button>
            </form>
          {:else}
            <p class="text-sm text-ink-800">
              <span class="font-medium">Non-essential OT.</span> Per §22.1, there
              is no force phase. The next step is to canvas qualified TMs from
              adjacent units; if still no takers, the posting is abandoned.
            </p>
            <form method="POST" action="?/escalate" use:enhance>
              <button class="btn-primary" type="submit">Canvas adjacent units</button>
            </form>
          {/if}
        {:else if data.escalation.outcome === 'in_progress' && data.posting.criticality === 'critical'}
          <!-- Critical: ask-high exhausted, offer force-low -->
          <p class="text-sm text-ink-800">
            Ask-high phase exhausted with {data.posting.volunteers_needed - data.yes_count} still short.
            Force-low: assign the {data.posting.volunteers_needed - data.yes_count} least-senior
            qualified TMs (excluding adjacent half-day PTO per PS-035).
          </p>
          <form method="POST" action="?/force_low" use:enhance class="flex gap-2 max-w-xl">
            <input name="reason" class="input flex-1" placeholder="Reason / context (e.g. line down, parts shortage)" required />
            <button class="btn-danger" type="submit">Execute force-low</button>
          </form>
        {:else if data.escalation.outcome === 'in_progress' && data.posting.criticality === 'non_essential'}
          <!-- Non-essential: cascade exhausted, offer abandonment -->
          <p class="text-sm text-ink-800">
            Cascade to adjacent units exhausted with {data.posting.volunteers_needed - data.yes_count} still short.
            Per §22.1, non-essential OT is not forced.
            The remaining option is to abandon the posting.
          </p>
          <form method="POST" action="?/abandon" use:enhance class="flex gap-2 max-w-xl">
            <input name="reason" class="input flex-1" placeholder="Reason for abandoning (logged for audit)" required />
            <button class="btn-secondary" type="submit">Abandon posting</button>
          </form>
        {:else}
          <p class="text-sm text-ink-700">Escalation outcome: {data.escalation.outcome.replace(/_/g, ' ')}.</p>
        {/if}
      </div>
    </div>
  {/if}

  <!-- Offer log -->
  <div class="card">
    <div class="card-header flex items-center justify-between">
      <span class="font-medium text-sm">Offer log for this posting</span>
      <span class="text-xs text-ink-500">{data.offerLog.length} offers</span>
    </div>
    <div class="card-body p-0">
      <table class="w-full text-sm table-zebra">
        <thead>
          <tr class="border-b border-ink-200 text-left">
            <th class="px-4 py-2 font-medium text-ink-600 text-xs uppercase">#</th>
            <th class="px-4 py-2 font-medium text-ink-600 text-xs uppercase">Team Member</th>
            <th class="px-4 py-2 font-medium text-ink-600 text-xs uppercase">Hire</th>
            <th class="px-4 py-2 font-medium text-ink-600 text-xs uppercase">Phase</th>
            <th class="px-4 py-2 font-medium text-ink-600 text-xs uppercase">Offered</th>
            <th class="px-4 py-2 font-medium text-ink-600 text-xs uppercase">Response</th>
            <th class="px-4 py-2 font-medium text-ink-600 text-xs uppercase">Recorded</th>
          </tr>
        </thead>
        <tbody>
          {#each data.offerLog as o, i}
            {@const r = responseLabel(o.response_type)}
            <tr class="border-b border-ink-100 last:border-b-0">
              <td class="px-4 py-2 text-ink-500 tabular">{i + 1}</td>
              <td class="px-4 py-2">{o.employee_name}</td>
              <td class="px-4 py-2 text-ink-600 tabular text-xs">{o.hire_date}</td>
              <td class="px-4 py-2 text-xs">
                {#if o.phase === 'ask_high'}<span class="badge-amber">ask-high</span>
                {:else if o.phase === 'force_low'}<span class="badge-red">force-low</span>
                {:else if o.phase === 'cascade'}<span class="badge-amber">cascade</span>
                {:else}<span class="text-ink-400">—</span>{/if}
              </td>
              <td class="px-4 py-2 text-xs text-ink-600">{formatDateTime(o.offered_at)}</td>
              <td class="px-4 py-2">
                {#if o.offer_status === 'pending'}
                  <span class="badge-blue">pending</span>
                {:else}
                  <span class="{r.cls}">{r.text}</span>
                {/if}
              </td>
              <td class="px-4 py-2 text-xs text-ink-600">
                {formatDateTime(o.recorded_at)}
                {#if o.recorded_via === 'supervisor_on_behalf'}<span class="text-ink-400"> &middot; on behalf</span>{/if}
                {#if o.reason}<div class="italic text-ink-500">{o.reason}</div>{/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>

  <!-- Bypass entry point -->
  {#if data.posting.status === 'open'}
    <details class="text-sm">
      <summary class="cursor-pointer text-ink-600 hover:text-ink-800">Flag a bypass</summary>
      <p class="text-xs text-ink-600 mt-2 max-w-lg">
        Use this if a TM should have been offered earlier and wasn't. The next
        eligible offer in this area where they qualify will go to them ahead of
        the normal rotation per §5.14.
      </p>
      <a href="/sv/bypass?area={data.posting.area_id}&posting={data.posting.id}" class="btn-secondary mt-2 inline-block">
        Open bypass remedy form &rarr;
      </a>
    </details>
  {/if}

  <!-- Cancellation -->
  {#if data.posting.status === 'open'}
    <details class="text-sm">
      <summary class="cursor-pointer text-ink-600 hover:text-ink-800">Cancel this posting</summary>
      <form method="POST" action="?/cancel" use:enhance class="mt-2 flex gap-2 max-w-lg">
        <input name="reason" class="input flex-1" placeholder="Reason for cancellation" required />
        <button type="submit" class="btn-danger">Cancel posting</button>
      </form>
      <p class="text-xs text-ink-500 mt-1">
        Per §22.3, cancellation reverses all charges.
      </p>
    </details>
  {/if}
</div>
