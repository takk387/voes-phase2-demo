<script lang="ts">
  import type { ActionData, PageData } from './$types';
  import { enhance } from '$app/forms';

  interface Props { data: PageData; form?: ActionData; }
  let { data, form }: Props = $props();

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
      case 'no_show': return { text: 'No-show', cls: 'badge-red' };
      case 'on_leave': return { text: 'On leave (no charge)', cls: 'badge-amber' };
      case 'on_the_job': return { text: 'On the job (no charge)', cls: 'badge-amber' };
      case 'no_contact': return { text: 'No contact (no charge)', cls: 'badge-amber' };
      case 'passed_over_unqualified': return { text: 'Not qualified (no charge)', cls: 'badge-gray' };
      default: return { text: t ?? '—', cls: 'badge-gray' };
    }
  }
  function multiplierLabel(m: number): string {
    if (m === 1.5) return '1.5×';
    if (m === 2.0) return '2.0×';
    return '1.0×';
  }
  function phaseBadge(p: string | null): { text: string; cls: string } | null {
    if (!p) return null;
    if (p === 'apprentice_escalation') return { text: 'apprentice escalation', cls: 'badge-amber' };
    if (p === 'inter_shop_canvass') return { text: 'inter-shop canvass', cls: 'badge-amber' };
    return { text: p, cls: 'badge-gray' };
  }
</script>

<div class="space-y-4">
  <a href="/coord" class="text-sm text-accent-700 hover:underline">&larr; back to dashboard</a>

  <!-- Posting summary -->
  <div class="card">
    <div class="card-header flex items-center justify-between">
      <div>
        <span class="font-semibold">Posting {data.posting.id}</span>
        <span class="ml-3 badge-blue">Skilled Trades</span>
        <span class="ml-2 text-xs text-ink-500">{data.posting.area_name}</span>
      </div>
      <span>
        {#if data.posting.pending_sv_approval}
          <span class="badge-amber">awaiting SV approval</span>
        {:else if data.posting.status === 'open'}
          <span class="badge-blue">open</span>
        {:else if data.posting.status === 'satisfied'}
          <span class="badge-green">satisfied</span>
        {:else if data.posting.status === 'cancelled'}
          <span class="badge-amber">cancelled</span>
        {:else}
          <span class="badge-gray">{data.posting.status}</span>
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
        <div class="text-xs text-ink-500 uppercase">Pay rate</div>
        <div class="font-medium">{multiplierLabel(data.posting.pay_multiplier)}</div>
      </div>
      <div>
        <div class="text-xs text-ink-500 uppercase">Filled / needed</div>
        <div class="font-medium tabular">{data.yes_count} / {data.posting.volunteers_needed}</div>
      </div>
      <div>
        <div class="text-xs text-ink-500 uppercase">Expertise / classification</div>
        <div class="font-medium text-xs">
          {data.posting.required_expertise ?? 'any expertise'}
          {#if data.posting.required_classification} &middot; {data.posting.required_classification}{/if}
        </div>
      </div>
      <div>
        <div class="text-xs text-ink-500 uppercase">Type</div>
        <div class="font-medium text-xs">
          {data.posting.ot_type.replace('voluntary_','').replace('_',' ')}
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
          <div class="text-xs text-ink-500 uppercase">Required quals (hard)</div>
          <div class="flex gap-2 flex-wrap mt-1">
            {#each data.requiredQuals as q}<span class="badge-blue">{q.name}</span>{/each}
          </div>
        </div>
      {/if}
      {#if data.preferredQuals.length > 0}
        <div class="col-span-full">
          <div class="text-xs text-ink-500 uppercase">Preferred quals (soft)</div>
          <div class="flex gap-2 flex-wrap mt-1">
            {#each data.preferredQuals as q}<span class="badge-gray">{q.name}</span>{/each}
          </div>
        </div>
      {/if}
    </div>
  </div>

  <!-- Awaiting SV approval banner (Step 6) -->
  {#if data.posting.pending_sv_approval}
    <div class="card border-amber-300 ring-1 ring-amber-200">
      <div class="card-header bg-amber-50/80">
        <span class="font-medium text-sm">Awaiting Skilled Trades supervisor approval</span>
      </div>
      <div class="card-body text-sm text-ink-800">
        <p>
          The algorithm has selected a proposed candidate (below). The dedicated
          ST supervisor for this area must approve the posting before the TM is
          notified or can respond.
        </p>
        {#if data.canApprove}
          <p class="text-xs text-ink-600 mt-2 italic">
            The approval queue ships in Step 7; for now ask the supervisor to
            handle it from <span class="font-mono">/sv/approvals</span> once
            available.
          </p>
        {/if}
      </div>
    </div>
  {/if}

  <!-- Active offer (proposed or pending) -->
  {#if data.activeDetails}
    <div class="card {data.activeDetails.is_proposed ? 'border-amber-300 ring-1 ring-amber-200' : 'border-accent-300 ring-1 ring-accent-200'}">
      <div class="card-header {data.activeDetails.is_proposed ? 'bg-amber-50/80' : 'bg-accent-50/80'}">
        <div class="flex items-center justify-between">
          <span class="font-medium text-sm">
            {#if data.activeDetails.is_proposed}
              Proposed offer — gated by SV approval
            {:else}
              Pending offer — awaiting response
            {/if}
          </span>
          {#if data.activeDetails.is_apprentice}
            <span class="badge-amber">apprentice</span>
          {/if}
        </div>
      </div>
      <div class="card-body">
        <div class="border border-ink-200 rounded p-3 bg-white mb-4">
          <div class="flex items-baseline justify-between">
            <div>
              <span class="text-lg font-semibold">{data.activeDetails.employee_name}</span>
              <span class="ml-3 text-xs text-ink-500">
                hire {data.activeDetails.hire_date}
                {#if data.activeDetails.classification && data.activeDetails.classification !== 'production'}
                  &middot; {data.activeDetails.classification}
                {/if}
              </span>
            </div>
            <div class="text-xs text-ink-500 tabular">
              hrs offered: {data.activeDetails.hours_offered} &middot;
              accepted: {data.activeDetails.hours_accepted}
            </div>
          </div>
          {#if data.activeDetails.eligibility_at_offer === 'on_rdo_volunteer'}
            <div class="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded px-3 py-1.5 mt-2">
              On <span class="font-medium">RDO</span> — eligible to volunteer.
              SKT-04A no-show penalty applies if they accept and don't show.
            </div>
          {/if}
          {#if data.activeDetails.soft_qual_names.length > 0}
            <div class="mt-2 flex gap-1 flex-wrap">
              <span class="text-xs text-ink-500">soft quals matched:</span>
              {#each data.activeDetails.soft_qual_names as q}
                <span class="badge-gray text-xs">{q}</span>
              {/each}
            </div>
          {/if}
          {#if data.activeDetails.qualifications.length}
            <div class="mt-2 flex gap-1 flex-wrap">
              <span class="text-xs text-ink-500">all quals:</span>
              {#each data.activeDetails.qualifications as q}
                <span class="badge-gray text-xs">{q.replace(' certification','').replace(' cert','')}</span>
              {/each}
            </div>
          {/if}
        </div>

        {#if !data.activeDetails.is_proposed}
          {#if data.posting.notification_policy === 'in_app_only_no_home_except_emergency'}
            <div class="text-xs text-ink-700 bg-ink-50 border border-ink-200 rounded px-3 py-2 mb-3">
              Per SKT-04A, this area is in-app-only — the TM responds in their
              dashboard. The buttons below are for recording an in-person
              response or marking unavailable.
            </div>
          {/if}
          <form method="POST" action="?/respond" use:enhance class="space-y-3">
            <input type="hidden" name="offer_id" value={data.activeDetails.offer_id} />
            <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <button class="btn-primary" name="response" value="yes" type="submit">Record YES</button>
              <button class="btn-secondary" name="response" value="no" type="submit">Record NO</button>
              <button class="btn-secondary" name="response" value="no_contact" type="submit">No contact</button>
            </div>
            <div class="border-t border-ink-200 pt-3">
              <div class="text-xs uppercase tracking-wide text-ink-500 mb-2">Other outcomes</div>
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <button class="btn-secondary text-xs" name="response" value="no_show" type="submit">No-show (post-shift)</button>
                <button class="btn-secondary text-xs" name="response" value="on_the_job" type="submit">On the job</button>
                <button class="btn-secondary text-xs" name="response" value="on_leave" type="submit">On approved leave</button>
              </div>
            </div>
            <div>
              <label for="reason" class="label">Reason / note (optional)</label>
              <input id="reason" name="reason" class="input" placeholder="e.g. spoke at 06:45, accepted verbally" />
            </div>
            {#if form?.error}
              <p class="text-sm text-red-700">{form.error}</p>
            {/if}
          </form>
        {:else}
          <p class="text-sm text-ink-600 italic">
            Response buttons disabled until the ST supervisor approves this posting.
          </p>
        {/if}
      </div>
    </div>
  {:else if data.eligiblePoolExhausted}
    <!-- ST pool exhausted: NO force-low per Critical Rule #4 -->
    <div class="card border-amber-300 ring-1 ring-amber-200">
      <div class="card-header bg-amber-50/80">
        <span class="font-medium text-sm">
          Eligible pool exhausted — {data.posting.volunteers_needed - data.yes_count} short
        </span>
      </div>
      <div class="card-body space-y-2 text-sm text-ink-800">
        <p>
          The rotation engine ran lowest-hours-first across in-area journeypersons,
          inter-shop canvass (where enabled), and apprentice escalation — no eligible
          candidate remains.
        </p>
        <p class="font-medium">
          Per SKT-04A interpretation, ST overtime is not force-able. If the work
          must happen, the Company can pursue the grievance procedure or an
          outside-contractor request; the system itself does not assign.
        </p>
        <p class="text-xs text-ink-600 italic">
          Critical Rule #4 in the implementation plan: no force-low for ST areas.
        </p>
      </div>
    </div>
  {/if}

  <!-- Accepted workers + release-excess control -->
  {#if data.acceptedWorkers.length > 0 && data.posting.status === 'open'}
    <div class="card">
      <div class="card-header">
        <span class="font-medium text-sm">Accepted workers ({data.acceptedWorkers.length})</span>
      </div>
      <div class="card-body">
        <ul class="text-sm divide-y divide-ink-100 mb-3">
          {#each data.acceptedWorkers as w}
            <li class="py-1.5 flex items-center justify-between">
              <span>{w.employee_name}{w.classification && w.classification !== 'production' ? ' · ' + w.classification : ''}</span>
              <span class="badge-green text-xs">accepted</span>
            </li>
          {/each}
        </ul>
        <details class="text-sm">
          <summary class="cursor-pointer text-ink-700 hover:text-ink-900">
            Need fewer workers? Release excess →
          </summary>
          <p class="text-xs text-ink-600 mt-2 max-w-lg">
            "Go home" flow (SKT-04A reverse-selection). Releases the highest-hours
            among accepted workers; charges for hours_accepted/worked are reversed
            for the released worker (the offer/hours_offered stays — they were still
            offered the slot).
          </p>
          <form method="POST" action="/coord/posting/{data.posting.id}/release-excess" use:enhance class="flex gap-2 mt-2 max-w-md">
            <input type="number" name="count" min="1" max={data.acceptedWorkers.length}
                   value="1" class="input w-24" required />
            <button type="submit" class="btn-secondary">Release N highest-hours</button>
          </form>
        </details>
      </div>
    </div>
  {/if}

  <!-- Offer log -->
  <div class="card">
    <div class="card-header flex items-center justify-between">
      <span class="font-medium text-sm">Offer log</span>
      <span class="text-xs text-ink-500">{data.offerLog.length} offers</span>
    </div>
    <div class="card-body p-0">
      <table class="w-full text-sm table-zebra">
        <thead>
          <tr class="border-b border-ink-200 text-left">
            <th class="px-4 py-2 font-medium text-ink-600 text-xs uppercase">#</th>
            <th class="px-4 py-2 font-medium text-ink-600 text-xs uppercase">TM</th>
            <th class="px-4 py-2 font-medium text-ink-600 text-xs uppercase">Class.</th>
            <th class="px-4 py-2 font-medium text-ink-600 text-xs uppercase">Phase</th>
            <th class="px-4 py-2 font-medium text-ink-600 text-xs uppercase">Eligibility</th>
            <th class="px-4 py-2 font-medium text-ink-600 text-xs uppercase">Offered</th>
            <th class="px-4 py-2 font-medium text-ink-600 text-xs uppercase">Response</th>
          </tr>
        </thead>
        <tbody>
          {#each data.offerLog as o, i}
            {@const r = responseLabel(o.response_type)}
            {@const ph = phaseBadge(o.phase)}
            <tr class="border-b border-ink-100 last:border-b-0">
              <td class="px-4 py-2 text-ink-500 tabular">{i + 1}</td>
              <td class="px-4 py-2">
                {o.employee_name}
                {#if o.is_apprentice}<span class="badge-amber text-xs ml-1">app.</span>{/if}
              </td>
              <td class="px-4 py-2 text-xs text-ink-600">
                {o.classification && o.classification !== 'production' ? o.classification : '—'}
              </td>
              <td class="px-4 py-2 text-xs">
                {#if ph}<span class="{ph.cls}">{ph.text}</span>
                {:else}<span class="text-ink-400">—</span>{/if}
              </td>
              <td class="px-4 py-2 text-xs text-ink-600">
                {#if o.eligibility_at_offer === 'on_rdo_volunteer'}
                  <span class="badge-amber text-xs">on RDO</span>
                {:else if o.eligibility_at_offer === 'on_normal_shift'}
                  <span class="text-ink-500">normal shift</span>
                {:else}
                  <span class="text-ink-400">—</span>
                {/if}
              </td>
              <td class="px-4 py-2 text-xs text-ink-600">{formatDateTime(o.offered_at)}</td>
              <td class="px-4 py-2">
                {#if o.offer_status === 'pending'}
                  <span class="badge-blue">pending</span>
                {:else if o.offer_status === 'proposed'}
                  <span class="badge-amber">proposed</span>
                {:else if o.offer_status === 'released'}
                  <span class="badge-amber">released</span>
                {:else}
                  <span class="{r.cls}">{r.text}</span>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>

  {#if data.posting.status === 'open'}
    <details class="text-sm">
      <summary class="cursor-pointer text-ink-600 hover:text-ink-800">Cancel this posting</summary>
      <form method="POST" action="?/cancel" use:enhance class="mt-2 flex gap-2 max-w-lg">
        <input name="reason" class="input flex-1" placeholder="Reason for cancellation" required />
        <button type="submit" class="btn-danger">Cancel posting</button>
      </form>
      <p class="text-xs text-ink-500 mt-1">
        Per §22.3, cancellation reverses all charges (including ST multiplier-weighted charges).
      </p>
    </details>
  {/if}
</div>
