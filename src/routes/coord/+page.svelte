<script lang="ts">
  import type { PageData } from './$types';
  interface Props { data: PageData; }
  let { data }: Props = $props();

  function formatDate(iso: string): string {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  function multiplierLabel(m: number): string {
    if (m === 1.5) return '1.5×';
    if (m === 2.0) return '2.0×';
    return '1.0×';
  }
</script>

<div class="space-y-6">
  <div class="flex items-baseline justify-between">
    <div>
      <h1 class="text-2xl font-semibold">STAC Coordinator dashboard</h1>
      <p class="text-sm text-ink-600 mt-0.5">
        Skilled Trades areas in your scope. Post a new opportunity, then the
        dedicated ST supervisor approves before the TM is notified.
      </p>
    </div>
  </div>

  {#each data.areas as area}
    <div class="card">
      <div class="card-header flex items-center justify-between">
        <div>
          <span class="font-semibold">{area.name}</span>
          <span class="ml-2 badge-blue">Skilled Trades</span>
          {#if area.allow_inter_shop_canvass}
            <span class="ml-1 badge-gray text-xs">inter-shop canvass enabled</span>
          {/if}
          <div class="text-xs text-ink-500 mt-0.5">
            {area.total_members} TMs &middot; {area.shop} &middot; {area.shift} shift
            {#if area.notification_policy === 'in_app_only_no_home_except_emergency'}
              &middot; <span class="italic">in-app only</span>
            {/if}
          </div>
        </div>
        <a href="/coord/post?area={area.id}" class="btn-primary text-xs px-3 py-1.5">Post new ST opportunity</a>
      </div>
      <div class="card-body space-y-4">
        <!-- Expertise breakdown + next-up -->
        <div class="grid sm:grid-cols-2 gap-3">
          {#each area.expertise as exp}
            <div class="border border-ink-200 rounded p-3">
              <div class="text-xs uppercase tracking-wide text-ink-500 mb-1">
                {exp.expertise}
              </div>
              <div class="flex items-baseline gap-3 text-sm">
                <span class="tabular"><span class="font-semibold">{exp.journey_count}</span> journey</span>
                <span class="text-ink-400">&middot;</span>
                <span class="tabular"><span class="font-semibold">{exp.apprentice_count}</span> apprentice</span>
              </div>
              {#if exp.next_up_name}
                <div class="text-xs text-ink-600 mt-1">
                  Next-up: <span class="font-medium">{exp.next_up_name}</span>
                  <span class="tabular text-ink-500">({exp.next_up_hours_offered} hrs offered)</span>
                </div>
              {:else}
                <div class="text-xs text-ink-500 italic mt-1">No journey TMs in this expertise.</div>
              {/if}
            </div>
          {/each}
        </div>

        <!-- Recent postings -->
        <div>
          <div class="text-xs uppercase tracking-wide text-ink-500 mb-2">Recent activity</div>
          {#if area.recent_postings.length === 0}
            <p class="text-sm text-ink-600">No postings yet.</p>
          {:else}
            <ul class="divide-y divide-ink-100 border border-ink-200 rounded">
              {#each area.recent_postings as p}
                <li class="px-3 py-2 flex items-center justify-between">
                  <div>
                    <div class="text-sm font-medium">
                      {p.duration_hours}-hour {multiplierLabel(p.pay_multiplier)}
                      {#if p.required_classification}
                        &middot; <span class="text-ink-700">{p.required_classification}</span>
                      {:else if p.required_expertise}
                        &middot; <span class="text-ink-700">any {p.required_expertise}</span>
                      {/if}
                    </div>
                    <div class="text-xs text-ink-600">
                      {formatDate(p.work_date)} &middot; {p.start_time} &middot; {p.yes_count}/{p.volunteers_needed} filled
                    </div>
                  </div>
                  <div class="flex items-center gap-2">
                    {#if p.pending_sv_approval}
                      <span class="badge-amber">awaiting SV</span>
                    {:else if p.status === 'open'}
                      <span class="badge-blue">open</span>
                    {:else if p.status === 'satisfied'}
                      <span class="badge-green">satisfied</span>
                    {:else if p.status === 'cancelled'}
                      <span class="badge-amber">cancelled</span>
                    {:else}
                      <span class="badge-gray">{p.status}</span>
                    {/if}
                    <a href="/coord/posting/{p.id}" class="text-xs text-accent-700 hover:underline">view &rarr;</a>
                  </div>
                </li>
              {/each}
            </ul>
          {/if}
        </div>

        <div class="flex gap-3">
          <a href="/tm/area?area={area.id}" class="text-sm text-accent-700 hover:underline">Area equalization list</a>
          <a href="/audit?area={area.id}" class="text-sm text-accent-700 hover:underline">Audit log</a>
        </div>
      </div>
    </div>
  {/each}

  {#if data.areas.length === 0}
    <p class="text-sm text-ink-600 italic">No ST areas in your scope.</p>
  {/if}
</div>
