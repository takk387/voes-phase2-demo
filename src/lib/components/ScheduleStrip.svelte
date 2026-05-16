<!--
  ScheduleStrip — Skilled Trades shift-pattern visualisation for the TM
  dashboard. Renders three views computed server-side from the cycle math
  in $lib/server/schedule_view:
    1. This-week 7-day strip (always shown)
    2. Next 4 weeks (expandable)
    3. Last 4 weeks (expandable — same math via negative dayDelta;
       useful for grievance reconstruction)

  Design: pixel-comparable cells. D = blue, A = amber, N = ink-700, RDO =
  ink-200. Today is outlined. The grid lays out as 7 columns × N rows so
  the rotation pattern visually matches the contract's tables.
-->
<script lang="ts">
  import type { ScheduleView, ScheduleGrid, ScheduleDay } from '$lib/server/schedule_view';

  interface Props { view: ScheduleView; }
  let { view }: Props = $props();

  let showNext = $state(false);
  let showLast = $state(false);

  function designationStyle(d: ScheduleDay): { cls: string; label: string } {
    switch (d.designation) {
      case 'D':
        return { cls: 'bg-blue-100 text-blue-900 border-blue-300', label: 'D' };
      case 'A':
        return { cls: 'bg-amber-100 text-amber-900 border-amber-300', label: 'A' };
      case 'N':
        return { cls: 'bg-ink-700 text-white border-ink-700', label: 'N' };
      case 'RDO':
        return { cls: 'bg-ink-100 text-ink-500 border-ink-200', label: 'RDO' };
      default:
        return { cls: 'bg-white text-ink-400 border-ink-200', label: '?' };
    }
  }

  // Splits a 28-day grid into 4 weeks of 7 days each (Monday-anchored).
  function chunkWeeks(grid: ScheduleGrid): ScheduleDay[][] {
    const weeks: ScheduleDay[][] = [];
    for (let i = 0; i < grid.days.length; i += 7) {
      weeks.push(grid.days.slice(i, i + 7));
    }
    return weeks;
  }

  function formatHeader(d: ScheduleDay): string {
    return `${d.weekday_short} ${d.day_of_month}`;
  }

  let nextWeeks = $derived(chunkWeeks(view.next_four_weeks));
  let lastWeeks = $derived(chunkWeeks(view.last_four_weeks));
</script>

<div class="card">
  <div class="card-header flex items-center justify-between">
    <div>
      <span class="font-medium text-sm">Your shift pattern</span>
      <span class="ml-2 badge-gray text-xs">{view.pattern_name}</span>
      {#if view.crew_position}
        <span class="ml-1 badge-gray text-xs">Crew {view.crew_position}</span>
      {/if}
    </div>
    <div class="flex gap-2 text-xs items-center">
      <span class="inline-block w-3 h-3 rounded bg-blue-100 border border-blue-300"></span><span class="text-ink-600">D</span>
      <span class="inline-block w-3 h-3 rounded bg-amber-100 border border-amber-300"></span><span class="text-ink-600">A</span>
      <span class="inline-block w-3 h-3 rounded bg-ink-700"></span><span class="text-ink-600">N</span>
      <span class="inline-block w-3 h-3 rounded bg-ink-100 border border-ink-200"></span><span class="text-ink-600">RDO</span>
    </div>
  </div>
  <div class="card-body space-y-3">
    {#if view.pattern_description}
      <p class="text-xs text-ink-600">{view.pattern_description}</p>
    {/if}

    <!-- This week strip -->
    <div>
      <div class="text-xs uppercase tracking-wide text-ink-500 mb-2">This week</div>
      <div class="grid grid-cols-7 gap-1.5">
        {#each view.this_week.days as day}
          {@const s = designationStyle(day)}
          <div class="flex flex-col items-center">
            <div class="text-[10px] text-ink-500 uppercase tracking-wide">{day.weekday_short}</div>
            <div class="text-[10px] text-ink-400 tabular">{day.day_of_month}</div>
            <div class="mt-1 w-full aspect-square rounded border {s.cls} flex items-center justify-center text-xs font-semibold {day.is_today ? 'ring-2 ring-accent-500 ring-offset-1' : ''}">
              {s.label}
            </div>
            {#if day.is_today}<div class="text-[9px] text-accent-700 mt-0.5">today</div>{/if}
          </div>
        {/each}
      </div>
    </div>

    <!-- Next 4 weeks expand -->
    <div>
      <button type="button"
              class="text-sm text-accent-700 hover:underline"
              onclick={() => (showNext = !showNext)}>
        {showNext ? '▾' : '▸'} Next 4 weeks
      </button>
      {#if showNext}
        <div class="mt-2 space-y-1.5">
          {#each nextWeeks as week, w}
            <div class="grid grid-cols-7 gap-1">
              {#each week as day}
                {@const s = designationStyle(day)}
                <div class="flex flex-col items-center">
                  {#if w === 0}
                    <div class="text-[9px] text-ink-500 uppercase">{day.weekday_short}</div>
                  {/if}
                  <div class="text-[9px] text-ink-400 tabular">{day.day_of_month}</div>
                  <div class="w-full aspect-square rounded border {s.cls} flex items-center justify-center text-[10px] font-medium {day.is_today ? 'ring-2 ring-accent-500 ring-offset-1' : ''}">
                    {s.label}
                  </div>
                </div>
              {/each}
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Last 4 weeks expand -->
    <div>
      <button type="button"
              class="text-sm text-accent-700 hover:underline"
              onclick={() => (showLast = !showLast)}>
        {showLast ? '▾' : '▸'} Last 4 weeks (history)
      </button>
      {#if showLast}
        <p class="text-xs text-ink-500 italic mt-1 mb-2">
          Reconstructs what shift you were on at any point in the last 28 days.
          Used for grievance research when an offer's eligibility is in question.
        </p>
        <div class="space-y-1.5">
          {#each lastWeeks as week, w}
            <div class="grid grid-cols-7 gap-1">
              {#each week as day}
                {@const s = designationStyle(day)}
                <div class="flex flex-col items-center">
                  {#if w === 0}
                    <div class="text-[9px] text-ink-500 uppercase">{day.weekday_short}</div>
                  {/if}
                  <div class="text-[9px] text-ink-400 tabular">{day.day_of_month}</div>
                  <div class="w-full aspect-square rounded border {s.cls} flex items-center justify-center text-[10px] font-medium">
                    {s.label}
                  </div>
                </div>
              {/each}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>
