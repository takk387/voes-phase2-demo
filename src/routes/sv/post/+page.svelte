<script lang="ts">
  import type { ActionData, PageData } from './$types';
  import { enhance } from '$app/forms';

  interface Props { data: PageData; form?: ActionData; }
  let { data, form }: Props = $props();

  // Default work date to tomorrow (typical "stay-over for next morning").
  const tomorrow = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  })();
</script>

<div class="max-w-2xl space-y-4">
  <a href="/sv" class="text-sm text-accent-700 hover:underline">&larr; back to dashboard</a>

  <div>
    <h1 class="text-2xl font-semibold">Post a new opportunity</h1>
    <p class="text-sm text-ink-600 mt-0.5">{data.area.name} &middot; {data.area.mode} mode</p>
  </div>

  <form method="POST" use:enhance class="card">
    <div class="card-body space-y-4">
      <input type="hidden" name="area_id" value={data.area.id} />

      <div class="grid sm:grid-cols-2 gap-4">
        <div>
          <label for="ot_type" class="label">OT type</label>
          <select id="ot_type" name="ot_type" class="input">
            <option value="voluntary_daily">Voluntary &mdash; daily / stay-over</option>
            <option value="voluntary_weekend">Voluntary &mdash; weekend</option>
            <option value="voluntary_holiday">Voluntary &mdash; holiday</option>
            <option value="late_add">Late-add</option>
          </select>
        </div>
        <div>
          <label for="criticality" class="label">Criticality</label>
          <select id="criticality" name="criticality" class="input">
            <option value="critical">Critical &mdash; force allowed if shortfall</option>
            <option value="non_essential">Non-essential &mdash; do not force</option>
          </select>
          <p class="text-xs text-ink-500 mt-1">
            Determines escalation behavior if volunteers fall short. Per §22.1:
            non-essential cascades to adjacent units, no force.
          </p>
        </div>
      </div>

      <div class="grid sm:grid-cols-3 gap-4">
        <div>
          <label for="work_date" class="label">Work date</label>
          <input id="work_date" name="work_date" type="date" class="input" required value={tomorrow} />
        </div>
        <div>
          <label for="start_time" class="label">Start time</label>
          <input id="start_time" name="start_time" type="time" class="input" required value="05:00" />
        </div>
        <div>
          <label for="duration_hours" class="label">Duration (hours)</label>
          <input id="duration_hours" name="duration_hours" type="number" step="0.5" min="0.5" class="input" required value="4" />
        </div>
      </div>

      <div>
        <label for="volunteers_needed" class="label">Volunteers needed</label>
        <input id="volunteers_needed" name="volunteers_needed" type="number" min="1" class="input w-32" required value="1" />
      </div>

      <div>
        <span class="label">Required qualifications (optional)</span>
        <div class="space-y-2">
          {#each data.qualifications as q}
            <label class="flex items-center gap-2 text-sm">
              <input type="checkbox" name="qualifications" value={q.id} class="rounded" />
              {q.name}
            </label>
          {/each}
        </div>
      </div>

      <div>
        <label for="notes" class="label">Notes (optional)</label>
        <textarea id="notes" name="notes" rows="2" class="input" placeholder="Context for TMs receiving the offer"></textarea>
      </div>

      {#if form?.error}
        <p class="text-sm text-red-700">{form.error}</p>
      {/if}

      <div class="flex justify-end gap-3 pt-2 border-t border-ink-200">
        <a href="/sv" class="btn-secondary">Cancel</a>
        <button type="submit" class="btn-primary">Post and start rotation</button>
      </div>
    </div>
  </form>
</div>
