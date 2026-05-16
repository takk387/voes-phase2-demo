<script lang="ts">
  import '../app.css';
  import type { LayoutData } from './$types';
  import PersonaSwitcher from '$lib/components/PersonaSwitcher.svelte';

  interface Props {
    data: LayoutData;
    children?: import('svelte').Snippet;
  }
  let { data, children }: Props = $props();
</script>

<div class="min-h-screen flex flex-col">
  <header class="bg-ink-900 text-white border-b border-ink-800">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
      <a href="/" class="flex items-center gap-3">
        <div class="w-8 h-8 rounded bg-accent-500 flex items-center justify-center font-bold text-sm">
          V
        </div>
        <div>
          <div class="font-semibold text-sm leading-tight">VOES</div>
          <div class="text-xs text-ink-300 leading-tight">
            Voluntary Overtime Equalization &middot; <span class="text-amber-300">Demo</span>
          </div>
        </div>
      </a>
      <PersonaSwitcher persona={data.persona} personas={data.personas} />
    </div>
  </header>

  {#if data.pendingForMe > 0}
    <a
      href="/approvals"
      class="block bg-amber-100 hover:bg-amber-200 transition-colors border-b border-amber-300"
    >
      <div class="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 flex items-center justify-between gap-3">
        <div class="flex items-center gap-3 text-sm">
          <span class="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-500 text-white text-xs font-bold">
            {data.pendingForMe}
          </span>
          <span class="text-amber-900">
            <span class="font-medium">
              {#if data.persona.role === 'union_rep'}
                Union approval needed
              {:else}
                Company approval needed
              {/if}
            </span>
            <span class="text-amber-800">
              — {data.pendingForMe} action{data.pendingForMe === 1 ? '' : 's'} awaiting your sign-off.
            </span>
          </span>
        </div>
        <span class="text-sm font-medium text-amber-900 hover:underline">Review &rarr;</span>
      </div>
    </a>
  {/if}

  <main class="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6">
    {@render children?.()}
  </main>

  <footer class="border-t border-ink-200 py-4 mt-8">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 text-xs text-ink-500 flex flex-wrap items-center justify-between gap-3">
      <span>VOES Phase 2 demo &middot; synthetic data &middot; not for production use</span>
      <nav class="flex items-center gap-4">
        {#if data.persona.role !== 'team_member'}
          <a href="/reports" class="hover:text-ink-700 underline">Reports</a>
        {/if}
        <a href="/audit" class="hover:text-ink-700 underline">Audit log</a>
        <a href="/walkthrough" class="hover:text-ink-700 underline">Walkthrough</a>
        <a href="/walkthrough-st" class="hover:text-ink-700 underline">ST walkthrough</a>
        <form
          method="POST"
          action="/demo/reset"
          onsubmit={(e) => {
            if (!confirm('Wipe all postings, offers, responses, charges, approvals, and audit log, and re-seed the demo to a clean state?\n\nYou cannot undo this.')) {
              e.preventDefault();
            }
          }}
          class="inline"
        >
          <button type="submit" class="hover:text-ink-700 underline">Reset demo</button>
        </form>
      </nav>
    </div>
  </footer>
</div>
