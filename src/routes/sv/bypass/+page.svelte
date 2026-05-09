<script lang="ts">
  import type { ActionData, PageData } from './$types';
  import { enhance } from '$app/forms';

  interface Props { data: PageData; form?: ActionData; }
  let { data, form }: Props = $props();

  function ageDays(iso: string): number {
    return Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 3600 * 1000));
  }
  function fmtDate(iso: string): string {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
</script>

<div class="space-y-6">
  <div>
    <a href="/sv" class="text-sm text-accent-700 hover:underline">&larr; back to dashboard</a>
    <h1 class="text-2xl font-semibold mt-2">Bypass remedy</h1>
    <p class="text-sm text-ink-600 mt-0.5">
      Flag a Team Member who should have been offered earlier. The next eligible
      offer in the area where they qualify will go to them ahead of normal
      rotation per CBA §5.14 / §10.17 (next-available remedy, not pay).
    </p>
  </div>

  {#if form?.error}
    <div class="bg-red-50 border border-red-200 text-red-800 text-sm rounded p-3">{form.error}</div>
  {/if}

  <div class="card">
    <div class="card-header">
      <span class="font-medium text-sm">Flag a new bypass</span>
    </div>
    <div class="card-body">
      <form method="POST" use:enhance class="space-y-4">
        <div>
          <label for="area_id" class="label">Area</label>
          <select id="area_id" name="area_id" class="input" onchange={(e) => {
            const v = (e.currentTarget as HTMLSelectElement).value;
            window.location.href = `/sv/bypass?area=${v}`;
          }}>
            {#each data.areas as a}
              <option value={a.id} selected={a.id === data.preselectedArea}>{a.name}</option>
            {/each}
          </select>
        </div>

        <div>
          <label for="affected_employee_id" class="label">Affected Team Member</label>
          <select id="affected_employee_id" name="affected_employee_id" class="input" required>
            <option value="">— select TM —</option>
            {#each data.members as m}
              <option value={m.id}>{m.display_name} (hire {m.hire_date})</option>
            {/each}
          </select>
          <p class="text-xs text-ink-500 mt-1">
            The TM who should have been offered but wasn't.
          </p>
        </div>

        <div>
          <label for="missed_offer_id" class="label">Missed offer reference (optional)</label>
          <select id="missed_offer_id" name="missed_offer_id" class="input">
            <option value="">— none / unspecified —</option>
            {#each data.recentPostings as p}
              <option value={p.id} selected={p.id === data.preselectedPosting}>
                {p.id} &middot; {fmtDate(p.work_date)} {p.start_time} &middot; {p.duration_hours}h ({p.status})
              </option>
            {/each}
          </select>
          <p class="text-xs text-ink-500 mt-1">
            If you can identify the specific posting that should have reached this TM, link it for the audit trail.
          </p>
        </div>

        <div>
          <label for="cause" class="label">Cause</label>
          <textarea id="cause" name="cause" class="input" rows="3" placeholder="e.g. Mis-read rotation list — offered Iqbal when Hansen had lower hours" required></textarea>
        </div>

        <div class="flex justify-end gap-3 pt-3 border-t border-ink-200">
          <a href="/sv" class="btn-secondary">Cancel</a>
          <button type="submit" class="btn-primary">Initiate remedy</button>
        </div>
      </form>
    </div>
  </div>

  <div class="card">
    <div class="card-header flex items-center justify-between">
      <span class="font-medium text-sm">Open remedies</span>
      <span class="text-xs text-ink-500">{data.openRemedies.length} pending</span>
    </div>
    <div class="card-body p-0">
      {#if data.openRemedies.length === 0}
        <p class="text-sm text-ink-600 px-4 py-4">No open bypass remedies in your scope.</p>
      {:else}
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-ink-200 text-left">
              <th class="px-4 py-2 font-medium text-ink-600 text-xs uppercase">Affected TM</th>
              <th class="px-4 py-2 font-medium text-ink-600 text-xs uppercase">Area</th>
              <th class="px-4 py-2 font-medium text-ink-600 text-xs uppercase">Recorded</th>
              <th class="px-4 py-2 font-medium text-ink-600 text-xs uppercase">Age</th>
              <th class="px-4 py-2 font-medium text-ink-600 text-xs uppercase">Cause</th>
            </tr>
          </thead>
          <tbody>
            {#each data.openRemedies as r}
              {@const age = ageDays(r.recorded_at)}
              <tr class="border-b border-ink-100 last:border-b-0">
                <td class="px-4 py-2 font-medium">{r.affected_employee_name}</td>
                <td class="px-4 py-2 text-ink-600 text-xs">{r.area_name}</td>
                <td class="px-4 py-2 text-xs text-ink-600">{new Date(r.recorded_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                <td class="px-4 py-2 tabular text-xs">
                  {age}d
                  {#if age >= 75 && age < 90}
                    <span class="badge-amber ml-1">approaching window</span>
                  {:else if age >= 90}
                    <span class="badge-red ml-1">past 90d</span>
                  {/if}
                </td>
                <td class="px-4 py-2 text-xs text-ink-700">{r.cause}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        <div class="px-4 py-3 text-xs text-ink-500 border-t border-ink-100">
          Per §22.8 (default 90 days), remedies not satisfied within the window
          escalate to the grievance procedure. The system flags but does not
          act — Joint Committee review.
        </div>
      {/if}
    </div>
  </div>
</div>
