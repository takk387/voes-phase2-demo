<script lang="ts">
  import type { Persona, PersonaRole } from '$lib/personas';

  interface Props {
    persona: Persona;
    personas: Persona[];
  }
  let { persona, personas }: Props = $props();

  let open = $state(false);

  function roleLabel(role: PersonaRole): string {
    switch (role) {
      case 'team_member': return 'Team Member';
      case 'supervisor': return 'Supervisor';
      case 'st_supervisor': return 'ST Supervisor';
      case 'skt_coordinator': return 'STAC Coordinator';
      case 'skt_tl': return 'Skilled Trades TL';
      case 'union_rep': return 'Union Rep';
      case 'plant_manager': return 'Plant Mgmt';
      case 'admin': return 'Admin';
    }
  }

  function roleColor(role: PersonaRole): string {
    switch (role) {
      case 'team_member': return 'bg-emerald-500';
      case 'supervisor': return 'bg-accent-500';
      // Distinguish ST personas with slate / sky / indigo so the demo
      // reviewer can tell ST roles apart from production roles at a glance.
      case 'st_supervisor': return 'bg-sky-600';
      case 'skt_coordinator': return 'bg-indigo-600';
      case 'skt_tl': return 'bg-slate-600';
      case 'union_rep': return 'bg-amber-500';
      case 'plant_manager': return 'bg-rose-500';
      case 'admin': return 'bg-purple-500';
    }
  }

  // Group order in the dropdown — matches the implementation plan Step 5:
  // TM → Production SV → ST SV → STAC Coord → SKT TL → Union Rep →
  // Plant Mgmt → Admin.
  const ROLE_GROUP_ORDER: PersonaRole[] = [
    'team_member',
    'supervisor',
    'st_supervisor',
    'skt_coordinator',
    'skt_tl',
    'union_rep',
    'plant_manager',
    'admin'
  ];

  // Pre-compute the groups so the template stays simple. Each entry is
  // { role, label, members } where members preserves the order from
  // PERSONAS for deterministic display.
  const groups = $derived(
    ROLE_GROUP_ORDER
      .map((role) => ({
        role,
        label: roleLabel(role),
        members: personas.filter((p) => p.role === role)
      }))
      .filter((g) => g.members.length > 0)
  );
</script>

<div class="relative">
  <button
    type="button"
    onclick={() => (open = !open)}
    class="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-ink-800 transition-colors text-left"
    aria-haspopup="menu"
    aria-expanded={open}
  >
    <div class="w-8 h-8 rounded-full {roleColor(persona.role)} flex items-center justify-center text-xs font-semibold uppercase">
      {persona.display_name.split(' ')[0].charAt(0)}
    </div>
    <div class="hidden sm:block">
      <div class="text-sm font-medium leading-tight">{persona.display_name}</div>
      <div class="text-xs text-ink-300 leading-tight">{roleLabel(persona.role)} &middot; switch persona</div>
    </div>
    <svg class="w-4 h-4 text-ink-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
    </svg>
  </button>

  {#if open}
    <!-- backdrop to close -->
    <button
      type="button"
      class="fixed inset-0 z-10 cursor-default"
      aria-label="Close menu"
      onclick={() => (open = false)}
    ></button>

    <div role="menu" class="absolute right-0 mt-2 w-80 rounded-lg shadow-lg bg-white border border-ink-200 z-20 overflow-hidden">
      <div class="px-4 py-2 border-b border-ink-100 bg-ink-50">
        <div class="text-xs uppercase tracking-wide text-ink-500 font-semibold">
          Switch persona
        </div>
        <div class="text-xs text-ink-600 mt-0.5">
          Demo mode &middot; no real authentication
        </div>
      </div>
      <div class="max-h-96 overflow-y-auto">
        {#each groups as group}
          <div class="px-4 py-1.5 bg-ink-100/60 border-b border-ink-200">
            <div class="text-[10px] uppercase tracking-wider text-ink-600 font-semibold">
              {group.label}
            </div>
          </div>
          {#each group.members as p}
            <form method="POST" action="/persona" class="block">
              <input type="hidden" name="persona_id" value={p.id} />
              <button
                type="submit"
                class="w-full text-left px-4 py-3 hover:bg-ink-50 border-b border-ink-100 last:border-b-0 flex items-start gap-3 {p.id === persona.id ? 'bg-accent-50' : ''}"
              >
                <div class="w-8 h-8 mt-0.5 rounded-full {roleColor(p.role)} flex-shrink-0 flex items-center justify-center text-xs font-semibold text-white uppercase">
                  {p.display_name.split(' ')[0].charAt(0)}
                </div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="font-medium text-sm text-ink-900">{p.display_name}</span>
                    {#if p.id === persona.id}
                      <span class="badge-blue">current</span>
                    {/if}
                  </div>
                  <div class="text-xs text-ink-500 mt-0.5">{roleLabel(p.role)}</div>
                  <div class="text-xs text-ink-600 mt-1">{p.description}</div>
                </div>
              </button>
            </form>
          {/each}
        {/each}
      </div>
    </div>
  {/if}
</div>
