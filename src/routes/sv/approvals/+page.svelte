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
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  }
  function multiplierLabel(m: number): string {
    if (m === 1.5) return '1.5×';
    if (m === 2.0) return '2.0×';
    return '1.0×';
  }
  function actionLabel(a: string): string {
    if (a === 'sv_approved_st_posting') return 'Approved';
    if (a === 'sv_rejected_st_posting') return 'Rejected';
    return a;
  }

  // One reject form open at a time.
  let rejectingId: string | null = $state(null);
</script>

<div class="space-y-6">
  <div>
    <h1 class="text-2xl font-semibold">ST posting approvals</h1>
    <p class="text-sm text-ink-600 mt-0.5">
      Skilled Trades postings posted by the STAC Coordinator or Skilled Trades
      TL require your approval before the proposed candidate is notified
      (Critical Rule #5; SKT-04A page 215). Reject is terminal — the
      originator can post again with revisions.
    </p>
  </div>

  {#if form?.error}
    <div class="bg-red-50 border border-red-200 text-red-800 text-sm rounded p-3">{form.error}</div>
  {/if}

  <div class="card">
    <div class="card-header flex items-center justify-between">
      <span class="font-medium text-sm">Pending approval</span>
      <span class="text-xs text-ink-500">{data.pending.length} waiting</span>
    </div>
    <div class="card-body space-y-4">
      {#if data.pending.length === 0}
        <p class="text-sm text-ink-600">No postings awaiting your approval.</p>
      {:else}
        {#each data.pending as p}
          <div class="border border-ink-200 rounded p-4 space-y-3">
            <div class="flex items-baseline justify-between gap-3 flex-wrap">
              <div>
                <div class="text-base font-semibold">
                  {p.duration_hours}-hour {p.ot_type.replace('voluntary_','').replace('_',' ')}
                  <span class="ml-1 text-xs badge-blue">{multiplierLabel(p.pay_multiplier)}</span>
                  {#if p.criticality === 'non_essential'}
                    <span class="ml-1 text-xs badge-gray">non-essential</span>
                  {/if}
                </div>
                <div class="text-sm text-ink-700">
                  {p.area_name} &middot; {formatDate(p.work_date)} &middot; {p.start_time}
                </div>
                <div class="text-xs text-ink-500 mt-0.5">
                  Posted by <span class="font-mono">{p.posted_by_user}</span> at {formatDateTime(p.posted_at)}
                </div>
              </div>
            </div>

            {#if p.required_classification || p.required_expertise || p.requiredQuals.length > 0 || p.preferredQuals.length > 0}
              <div class="text-xs text-ink-700 flex flex-wrap gap-2">
                {#if p.required_classification}
                  <span class="badge-gray">Classification: {p.required_classification}</span>
                {:else if p.required_expertise}
                  <span class="badge-gray">Expertise: any {p.required_expertise}</span>
                {/if}
                {#each p.requiredQuals as q}
                  <span class="badge-blue">required: {q}</span>
                {/each}
                {#each p.preferredQuals as q}
                  <span class="badge-amber">preferred: {q}</span>
                {/each}
              </div>
            {/if}

            {#if p.notes}
              <div class="text-sm bg-ink-50 px-3 py-2 rounded border border-ink-200">
                <span class="text-xs uppercase tracking-wide text-ink-500 block mb-1">Originator note</span>
                {p.notes}
              </div>
            {/if}

            {#if p.proposed}
              <div class="border border-ink-200 rounded p-3 bg-ink-50/40">
                <div class="text-xs uppercase tracking-wide text-ink-500 mb-1">Proposed candidate</div>
                <div class="flex items-baseline justify-between flex-wrap gap-2">
                  <div>
                    <span class="font-medium">{p.proposed.employee_name}</span>
                    {#if p.proposed.classification}
                      <span class="text-xs text-ink-600 ml-1">&middot; {p.proposed.classification}</span>
                    {/if}
                    {#if p.proposed.is_apprentice}
                      <span class="ml-1 badge-amber text-xs">apprentice</span>
                    {/if}
                    {#if p.proposed.phase === 'apprentice_escalation'}
                      <span class="ml-1 badge-amber text-xs">apprentice escalation</span>
                    {/if}
                    {#if p.proposed.phase === 'inter_shop_canvass'}
                      <span class="ml-1 badge-blue text-xs">inter-shop canvass</span>
                    {/if}
                    {#if p.proposed.eligibility_at_offer === 'on_rdo_volunteer'}
                      <span class="ml-1 badge-amber text-xs">on RDO (volunteer)</span>
                    {/if}
                  </div>
                  {#if p.candidateHours}
                    <div class="text-xs text-ink-600 tabular">
                      {p.candidateHours.hours_offered}h offered &middot;
                      {p.candidateHours.hours_accepted}h accepted
                    </div>
                  {/if}
                </div>
              </div>
            {:else}
              <div class="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
                No proposed candidate — eligible pool empty. Review and reject
                to clear the queue, or work with the originator to revise scope.
              </div>
            {/if}

            <div class="flex flex-wrap items-start gap-3 pt-1">
              <form method="POST" action="?/approve" use:enhance>
                <input type="hidden" name="posting_id" value={p.id} />
                <button class="btn-primary text-sm px-4 py-1.5" type="submit">
                  Approve &amp; notify candidate
                </button>
              </form>

              {#if rejectingId === p.id}
                <form
                  method="POST"
                  action="?/reject"
                  use:enhance={() => {
                    return async ({ update }) => {
                      rejectingId = null;
                      await update();
                    };
                  }}
                  class="flex-1 min-w-[260px] flex items-start gap-2"
                >
                  <input type="hidden" name="posting_id" value={p.id} />
                  <input
                    type="text"
                    name="reason"
                    required
                    minlength="1"
                    placeholder="Reason (required, e.g. work cancelled, scope wrong)"
                    class="input flex-1 text-sm"
                  />
                  <button class="btn-secondary text-sm px-3 py-1.5" type="submit">
                    Confirm reject
                  </button>
                  <button
                    type="button"
                    onclick={() => (rejectingId = null)}
                    class="text-xs text-ink-500 hover:underline self-center"
                  >
                    cancel
                  </button>
                </form>
              {:else}
                <button
                  type="button"
                  onclick={() => (rejectingId = p.id)}
                  class="btn-secondary text-sm px-3 py-1.5"
                >
                  Reject…
                </button>
              {/if}

              <a
                href="/coord/posting/{p.id}"
                class="text-xs text-accent-700 hover:underline self-center ml-auto"
              >
                Open full runner →
              </a>
            </div>
          </div>
        {/each}
      {/if}
    </div>
  </div>

  {#if data.recent.length > 0}
    <div class="card">
      <div class="card-header">
        <span class="font-medium text-sm">Recent decisions</span>
      </div>
      <div class="card-body">
        <ul class="text-sm divide-y divide-ink-100">
          {#each data.recent as r}
            <li class="py-2 flex items-baseline justify-between gap-3 flex-wrap">
              <div>
                <span class="font-mono text-xs text-ink-600">{r.posting_id}</span>
                <span class="ml-2 text-ink-700">{r.area_name}</span>
                {#if r.action === 'sv_approved_st_posting'}
                  <span class="ml-2 badge-green text-xs">approved</span>
                {:else}
                  <span class="ml-2 badge-amber text-xs">rejected</span>
                {/if}
              </div>
              <div class="text-xs text-ink-500 text-right">
                <div>{actionLabel(r.action)} by <span class="font-mono">{r.actor_user}</span></div>
                <div>{formatDateTime(r.ts)}</div>
                {#if r.reason}<div class="italic">"{r.reason}"</div>{/if}
              </div>
            </li>
          {/each}
        </ul>
      </div>
    </div>
  {/if}

  <div class="text-xs text-ink-500">
    <a href="/sv" class="hover:underline">← back to SV dashboard</a>
  </div>
</div>
