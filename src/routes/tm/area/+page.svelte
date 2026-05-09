<script lang="ts">
  import type { PageData } from './$types';
  interface Props { data: PageData; }
  let { data }: Props = $props();

  const isFinal = $derived(data.area.mode === 'final');
  const sortedStanding = $derived(
    isFinal
      ? [...data.standing].sort((a, b) => {
          if (a.hours_offered !== b.hours_offered) return a.hours_offered - b.hours_offered;
          return a.hire_date < b.hire_date ? -1 : 1;
        })
      : data.standing
  );
</script>

<div class="space-y-4">
  <div class="flex items-baseline justify-between gap-4 flex-wrap">
    <div>
      <h1 class="text-2xl font-semibold">{data.area.area_name}</h1>
      <p class="text-sm text-ink-600">
        Equalization list &middot; {data.area.mode} mode &middot; cycle {data.cycle}
      </p>
    </div>
    <div class="flex items-center gap-3">
      {#if data.canChooseArea}
        <form method="GET" class="flex items-center gap-2">
          <label for="area" class="text-xs text-ink-600">Area:</label>
          <select
            id="area"
            name="area"
            class="input text-sm py-1"
            onchange={(e) => {
              const v = (e.currentTarget as HTMLSelectElement).value;
              window.location.href = `/tm/area?area=${v}`;
            }}
          >
            {#each data.visibleAreas as a}
              <option value={a.id} selected={a.id === data.area.area_id}>{a.name}</option>
            {/each}
          </select>
        </form>
      {/if}
      <a href="/" class="text-sm text-accent-700 hover:underline">&larr; back</a>
    </div>
  </div>

  <div class="card">
    <div class="card-body">
      <p class="text-xs text-ink-600 mb-3">
        Posted at: <span class="font-medium">{data.area.posting_location}</span>.
        This list is the digital equivalent of the area's open-display rotation list.
      </p>
      <div class="overflow-x-auto">
        <table class="w-full text-sm table-zebra">
          <thead class="text-left">
            <tr class="border-b border-ink-200">
              <th class="py-2 px-2 font-semibold w-12">#</th>
              <th class="py-2 px-2 font-semibold">Team Member</th>
              <th class="py-2 px-2 font-semibold">Hire date</th>
              {#if isFinal}
                <th class="py-2 px-2 font-semibold tabular text-right">Hrs offered</th>
                <th class="py-2 px-2 font-semibold tabular text-right">Hrs accepted</th>
                <th class="py-2 px-2 font-semibold tabular text-right">Hrs worked</th>
              {:else}
                <th class="py-2 px-2 font-semibold tabular text-right">This cycle</th>
                <th class="py-2 px-2 font-semibold tabular text-right">Lifetime</th>
              {/if}
              <th class="py-2 px-2 font-semibold">Quals</th>
              <th class="py-2 px-2 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {#each sortedStanding as r, i}
              <tr class="border-b border-ink-100 last:border-b-0 {r.employee_id === data.myEmployeeId ? 'bg-accent-50/50 font-medium' : ''}">
                <td class="py-2 px-2 text-ink-500 tabular">{isFinal ? i + 1 : r.rotation_position}</td>
                <td class="py-2 px-2">
                  {r.display_name}
                  {#if r.employee_id === data.myEmployeeId}
                    <span class="ml-2 badge-blue">you</span>
                  {/if}
                  {#if isFinal && i === 0}
                    <span class="ml-2 badge-green">next up</span>
                  {/if}
                </td>
                <td class="py-2 px-2 text-ink-600 tabular text-xs">{r.hire_date}</td>
                {#if isFinal}
                  <td class="py-2 px-2 text-right tabular">{r.hours_offered}</td>
                  <td class="py-2 px-2 text-right tabular">{r.hours_accepted}</td>
                  <td class="py-2 px-2 text-right tabular">{r.hours_worked}</td>
                {:else}
                  <td class="py-2 px-2 text-right tabular">{r.cycle_charges}</td>
                  <td class="py-2 px-2 text-right tabular">{r.lifetime_charges}</td>
                {/if}
                <td class="py-2 px-2">
                  <div class="flex gap-1 flex-wrap">
                    {#each r.qualifications as q}
                      <span class="badge-gray text-xs">{q.replace(' certification','').replace(' cert','')}</span>
                    {/each}
                  </div>
                </td>
                <td class="py-2 px-2">
                  {#if r.on_leave}
                    <span class="badge-amber">on leave</span>
                  {:else if r.status === 'active'}
                    <span class="badge-green">active</span>
                  {:else}
                    <span class="badge-gray">{r.status}</span>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      {#if isFinal}
        <p class="text-xs text-ink-500 mt-3">
          Sorted by hours offered (lowest first). The lowest-hours qualified TM
          gets the next offer; ties break by seniority.
        </p>
      {:else}
        <p class="text-xs text-ink-500 mt-3">
          Sorted by seniority. Offers cycle top-to-bottom; the cycle resets
          when every active TM has been offered.
        </p>
      {/if}
    </div>
  </div>
</div>
