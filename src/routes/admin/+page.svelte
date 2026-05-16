<script lang="ts">
  import type { ActionData, PageData } from './$types';
  import { enhance } from '$app/forms';

  interface Props { data: PageData; form?: ActionData; }
  let { data, form }: Props = $props();
</script>

<div class="space-y-6">
  <div>
    <h1 class="text-2xl font-semibold">Admin</h1>
    <p class="text-sm text-ink-600 mt-0.5">
      Configuration and periodic operations. High-impact actions require dual approval.
    </p>
  </div>

  {#if form?.error}
    <div class="bg-red-50 border border-red-200 text-red-800 text-sm rounded p-3">{form.error}</div>
  {/if}

  {#if data.pending.length > 0}
    <div class="card border-amber-300 ring-1 ring-amber-200">
      <div class="card-header bg-amber-50/80">
        <span class="font-medium text-sm">Pending approvals ({data.pending.length})</span>
      </div>
      <div class="card-body">
        <p class="text-sm text-ink-700">
          {data.pending.length} action{data.pending.length === 1 ? '' : 's'} awaiting Plant Mgmt and/or Union sign-off.
        </p>
        <a href="/approvals" class="btn-secondary mt-3 inline-block">View approval queue</a>
      </div>
    </div>
  {/if}

  <div class="card">
    <div class="card-header">
      <span class="font-medium text-sm">Equalization areas</span>
    </div>
    <div class="card-body p-0">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-ink-200 text-left">
            <th class="px-4 py-2 font-medium text-ink-600 text-xs uppercase">Area</th>
            <th class="px-4 py-2 font-medium text-ink-600 text-xs uppercase">Mode</th>
            <th class="px-4 py-2 font-medium text-ink-600 text-xs uppercase tabular text-right">TMs</th>
            <th class="px-4 py-2 font-medium text-ink-600 text-xs uppercase tabular text-right">Cycle</th>
            <th class="px-4 py-2 font-medium text-ink-600 text-xs uppercase">Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each data.areas as a}
            <tr class="border-b border-ink-100 last:border-b-0">
              <td class="px-4 py-3">
                <div class="font-medium">
                  {a.name}
                  {#if a.type === 'skilled_trades'}
                    <span class="ml-1 badge-blue text-xs">Skilled Trades</span>
                  {/if}
                </div>
                <div class="text-xs text-ink-500 font-mono">{a.id}</div>
              </td>
              <td class="px-4 py-3">
                {#if a.type === 'skilled_trades'}
                  <span class="badge-gray text-xs italic">n/a (ST)</span>
                {:else if a.mode === 'final'}
                  <span class="badge-blue">final</span>
                  {#if a.first_cycle === 1}
                    <span class="badge-amber ml-1">first cycle</span>
                  {/if}
                {:else}
                  <span class="badge-gray">interim</span>
                {/if}
              </td>
              <td class="px-4 py-3 text-right tabular">{a.tm_count}</td>
              <td class="px-4 py-3 text-right tabular">
                {a.type === 'skilled_trades' ? '—' : a.current_cycle}
              </td>
              <td class="px-4 py-3">
                <div class="flex gap-2 flex-wrap">
                  {#if a.type === 'skilled_trades'}
                    <!-- ST uses SKT-04A continuous final-mode; no cutover -->
                    <span class="text-xs text-ink-500 italic">No cutover (SKT-04A)</span>
                  {:else if a.mode === 'interim'}
                    <form method="POST" action="?/initiate_cutover" use:enhance>
                      <input type="hidden" name="area_id" value={a.id} />
                      <button class="btn-secondary text-xs px-3 py-1.5" type="submit">
                        Initiate cutover →
                      </button>
                    </form>
                  {/if}
                  <form method="POST" action="?/initiate_zero_out" use:enhance>
                    <input type="hidden" name="area_id" value={a.id} />
                    <button class="btn-secondary text-xs px-3 py-1.5" type="submit">
                      Initiate zero-out
                    </button>
                  </form>
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>

  <div class="card">
    <div class="card-header">
      <span class="font-medium text-sm">Plant-wide actions</span>
    </div>
    <div class="card-body space-y-3">
      <form method="POST" action="?/initiate_zero_out" use:enhance class="flex items-center gap-3">
        <button class="btn-secondary text-sm" type="submit">Initiate plant-wide annual zero-out</button>
        <span class="text-xs text-ink-500">All areas reset together. Requires both approvals.</span>
      </form>
    </div>
  </div>

  <div class="card">
    <div class="card-header">
      <span class="font-medium text-sm">Structural changes</span>
      <span class="ml-2 text-xs text-ink-500">all require dual approval</span>
    </div>
    <div class="card-body space-y-5">
      <!-- Split -->
      <details>
        <summary class="cursor-pointer text-sm font-medium">Split an area</summary>
        <form method="POST" action="?/initiate_split" use:enhance class="mt-3 grid sm:grid-cols-3 gap-3 max-w-3xl">
          <div>
            <label class="label" for="split_source">Source area</label>
            <select id="split_source" name="source_area_id" class="input" required>
              <option value="">— select —</option>
              {#each data.areas as a}
                <option value={a.id}>{a.name}</option>
              {/each}
            </select>
          </div>
          <div>
            <label class="label" for="split_a">New "A" name</label>
            <input id="split_a" name="new_area_a_name" class="input" placeholder="e.g. BA2-A 1st shift" required />
          </div>
          <div>
            <label class="label" for="split_b">New "B" name</label>
            <input id="split_b" name="new_area_b_name" class="input" placeholder="e.g. BA2-B 1st shift" required />
          </div>
          <div class="sm:col-span-3 flex items-center justify-between">
            <p class="text-xs text-ink-500">
              Default rule: more-senior half &rarr; A, less-senior half &rarr; B. Hours follow each TM (per §10.22).
            </p>
            <button class="btn-secondary text-xs" type="submit">Initiate split &rarr; approval</button>
          </div>
        </form>
      </details>

      <!-- Merge -->
      <details>
        <summary class="cursor-pointer text-sm font-medium">Merge two areas</summary>
        <form method="POST" action="?/initiate_merge" use:enhance class="mt-3 grid sm:grid-cols-3 gap-3 max-w-3xl">
          <div>
            <label class="label" for="merge_a">Source A</label>
            <select id="merge_a" name="source_a_id" class="input" required>
              <option value="">— select —</option>
              {#each data.areas as a}<option value={a.id}>{a.name}</option>{/each}
            </select>
          </div>
          <div>
            <label class="label" for="merge_b">Source B</label>
            <select id="merge_b" name="source_b_id" class="input" required>
              <option value="">— select —</option>
              {#each data.areas as a}<option value={a.id}>{a.name}</option>{/each}
            </select>
          </div>
          <div>
            <label class="label" for="merge_name">Combined name</label>
            <input id="merge_name" name="new_area_name" class="input" placeholder="e.g. BA-23 1st shift" required />
          </div>
          <div class="sm:col-span-3 flex items-center justify-between">
            <p class="text-xs text-ink-500">All TMs join the new area; charges follow each TM. Source areas are retired.</p>
            <button class="btn-secondary text-xs" type="submit">Initiate merge &rarr; approval</button>
          </div>
        </form>
      </details>

      <!-- Retire -->
      <details>
        <summary class="cursor-pointer text-sm font-medium">Retire an area</summary>
        <form method="POST" action="?/initiate_retire" use:enhance class="mt-3 flex items-end gap-3 max-w-2xl">
          <div class="flex-1">
            <label class="label" for="retire_area">Area to retire</label>
            <select id="retire_area" name="area_id" class="input" required>
              <option value="">— select —</option>
              {#each data.areas as a}<option value={a.id}>{a.name}</option>{/each}
            </select>
          </div>
          <button class="btn-danger text-xs" type="submit">Initiate retire &rarr; approval</button>
        </form>
        <p class="text-xs text-ink-500 mt-2">
          Pending postings cancelled. Active memberships ended. History preserved
          per retention policy. Production reassignment of TMs is handled outside the system.
        </p>
      </details>
    </div>
  </div>

  <div class="card">
    <div class="card-header">
      <span class="font-medium text-sm">Skilled Trades references</span>
    </div>
    <div class="card-body space-y-2 text-sm">
      <a href="/admin/patterns" class="text-accent-700 hover:underline">
        Shift pattern preview →
      </a>
      <p class="text-xs text-ink-500">
        Renders all 8 SKT-04A shift patterns (fixed_day, fixed_evening,
        fixed_night, 1_crew_weekend, 2_crew_fixed_d_n,
        2_crew_fixed_d_afternoon, 4_crew_12h_rotating, 4_crew_12h_fixed)
        as crew × day calendars. Use to verify the rotation math against
        the contract images.
      </p>
    </div>
  </div>

  <div class="text-xs text-ink-500">
    Slice 4 will add HRIS sync controls, qualification catalog management, and the walkthrough script.
  </div>
</div>
