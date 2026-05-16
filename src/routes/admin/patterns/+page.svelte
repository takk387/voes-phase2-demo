<script lang="ts">
  import type { PageData } from './$types';
  import type { ShiftDesignation } from '$lib/server/schedule_eligibility';

  interface Props { data: PageData; }
  let { data }: Props = $props();

  function cellClass(d: ShiftDesignation): string {
    switch (d) {
      case 'D':   return 'bg-blue-100 text-blue-900 border-blue-300';
      case 'A':   return 'bg-amber-100 text-amber-900 border-amber-300';
      case 'N':   return 'bg-ink-700 text-white border-ink-700';
      case 'RDO': return 'bg-ink-100 text-ink-500 border-ink-200';
      default:    return 'bg-white text-ink-400 border-ink-200';
    }
  }

  // Crew totals — visualises asymmetry (e.g. 4_crew_12h_rotating Crew 4 is
  // predominantly nights per the contract).
  function crewTotals(row: ShiftDesignation[]): { D: number; A: number; N: number; RDO: number } {
    const t = { D: 0, A: 0, N: 0, RDO: 0 };
    for (const d of row) t[d]++;
    return t;
  }

  // Chunk a single crew's full cycle into rows of 7 cells for a calendar feel.
  function weekRows(cycle: ShiftDesignation[]): ShiftDesignation[][] {
    const rows: ShiftDesignation[][] = [];
    for (let i = 0; i < cycle.length; i += 7) rows.push(cycle.slice(i, i + 7));
    return rows;
  }
</script>

<div class="space-y-6">
  <div class="flex items-baseline justify-between">
    <div>
      <h1 class="text-2xl font-semibold">Shift pattern preview</h1>
      <p class="text-sm text-ink-600 mt-0.5 max-w-3xl">
        Every Skilled-Trades shift pattern from SKT-04A (pages 213-217),
        rendered as a crew × day-of-cycle calendar. Use these grids to verify
        the system's rotation math against the contract images. D = day, A =
        afternoon, N = night, RDO = scheduled day off.
      </p>
    </div>
    <a href="/admin" class="text-sm text-accent-700 hover:underline">&larr; admin</a>
  </div>

  <div class="card">
    <div class="card-header">
      <span class="font-medium text-sm">Legend</span>
    </div>
    <div class="card-body flex flex-wrap gap-4 text-sm items-center">
      <span class="flex items-center gap-2"><span class="inline-block w-4 h-4 rounded bg-blue-100 border border-blue-300"></span> D — Day shift</span>
      <span class="flex items-center gap-2"><span class="inline-block w-4 h-4 rounded bg-amber-100 border border-amber-300"></span> A — Afternoon</span>
      <span class="flex items-center gap-2"><span class="inline-block w-4 h-4 rounded bg-ink-700"></span> <span class="text-ink-700">N — Night</span></span>
      <span class="flex items-center gap-2"><span class="inline-block w-4 h-4 rounded bg-ink-100 border border-ink-200"></span> RDO — Off</span>
    </div>
  </div>

  {#each data.patterns as p}
    <div class="card">
      <div class="card-header flex items-center justify-between">
        <div>
          <span class="font-semibold">{p.name}</span>
          <span class="ml-2 text-xs text-ink-500">
            cycle {p.cycle_length_days} days &middot; {p.crew_count} crew{p.crew_count > 1 ? 's' : ''}
          </span>
        </div>
        <span class="text-xs text-ink-500 font-mono">pattern id #{p.id}</span>
      </div>
      <div class="card-body space-y-3">
        {#if p.description}
          <p class="text-xs text-ink-600">{p.description}</p>
        {/if}

        <!-- One crew per row block; each block shows a Mon-Sun weekly grid -->
        <div class="space-y-4">
          {#each p.calendar as crewCycle, crewIdx}
            {@const rows = weekRows(crewCycle)}
            {@const totals = crewTotals(crewCycle)}
            <div>
              <div class="flex items-baseline justify-between mb-1">
                <div class="text-xs uppercase tracking-wide text-ink-600">
                  {#if p.crew_count > 1}Crew {crewIdx + 1}{:else}Single crew{/if}
                </div>
                <div class="text-xs text-ink-500 tabular">
                  D {totals.D} &middot; A {totals.A} &middot; N {totals.N} &middot; RDO {totals.RDO}
                </div>
              </div>
              <div class="space-y-1">
                {#each rows as row}
                  <div class="grid grid-cols-7 gap-1">
                    {#each row as d}
                      <div class="aspect-square rounded border {cellClass(d)} flex items-center justify-center text-xs font-medium">
                        {d}
                      </div>
                    {/each}
                  </div>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      </div>
    </div>
  {/each}

  {#if data.patterns.length === 0}
    <p class="text-sm text-ink-600 italic">No shift patterns seeded.</p>
  {/if}
</div>
