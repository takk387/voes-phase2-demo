<script lang="ts">
  import type { ActionData, PageData } from './$types';
  import { enhance } from '$app/forms';

  interface Props { data: PageData; form?: ActionData; }
  let { data, form }: Props = $props();

  function formatDate(iso: string): string {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }
</script>

<div class="max-w-2xl space-y-4">
  <a href="/tm" class="text-sm text-accent-700 hover:underline">&larr; back to dashboard</a>

  <div class="card">
    <div class="card-header">
      <span class="font-medium text-sm">Pending offer</span>
    </div>
    <div class="card-body space-y-4">
      <div>
        <div class="text-2xl font-semibold">
          {data.offer.duration_hours}-hour {data.offer.ot_type.replace('voluntary_','').replace('_',' ')}
        </div>
        <div class="text-base text-ink-700 mt-1">
          {formatDate(data.offer.work_date)}
        </div>
        <div class="text-sm text-ink-600">
          Starts {data.offer.start_time} &middot; {data.offer.area_name}
        </div>
      </div>

      {#if data.offer.notes}
        <div class="text-sm bg-ink-50 px-3 py-2 rounded border border-ink-200">
          <span class="text-xs uppercase tracking-wide text-ink-500 block mb-1">Note from supervisor</span>
          {data.offer.notes}
        </div>
      {/if}

      {#if data.requiredQuals.length > 0}
        <div class="text-sm">
          <span class="text-xs uppercase tracking-wide text-ink-500">Qualifications required</span>
          <div class="mt-1 flex gap-2 flex-wrap">
            {#each data.requiredQuals as q}
              <span class="badge-blue">{q}</span>
            {/each}
          </div>
        </div>
      {:else}
        <div class="text-xs text-ink-500">No qualification required.</div>
      {/if}

      <div class="border-t border-ink-200 pt-4">
        {#if data.offer.offer_status !== 'pending'}
          <p class="text-sm text-ink-600">This offer is no longer pending.</p>
        {:else}
          <form method="POST" action="?/respond" use:enhance class="space-y-3">
            <div>
              <label for="note" class="label">Note (optional)</label>
              <textarea
                id="note"
                name="note"
                rows="2"
                class="input"
                placeholder="e.g. see you at 5 AM, or out of town this weekend"
              ></textarea>
            </div>
            <div class="flex gap-3">
              <button
                type="submit"
                name="response"
                value="yes"
                class="btn-primary flex-1"
              >
                Yes, I'll work
              </button>
              <button
                type="submit"
                name="response"
                value="no"
                class="btn-secondary flex-1"
              >
                No, not this time
              </button>
            </div>
            {#if form?.error}
              <p class="text-sm text-red-700">{form.error}</p>
            {/if}
            <p class="text-xs text-ink-500 mt-2">
              Saying Yes commits you to working this overtime. Failing to show up
              after committing is an unexcused absence under Article XIV.
            </p>
          </form>
        {/if}
      </div>
    </div>
  </div>
</div>
