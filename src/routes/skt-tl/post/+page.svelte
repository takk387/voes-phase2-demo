<script lang="ts">
  import type { ActionData, PageData } from './$types';
  import { enhance } from '$app/forms';
  import STPostingForm from '$lib/components/STPostingForm.svelte';

  interface Props { data: PageData; form?: ActionData; }
  let { data, form }: Props = $props();
</script>

<div class="max-w-3xl space-y-4">
  <a href="/skt-tl" class="text-sm text-accent-700 hover:underline">&larr; back to dashboard</a>

  <div>
    <h1 class="text-2xl font-semibold">Post a new ST opportunity</h1>
    <p class="text-sm text-ink-600 mt-0.5">
      Same flow as the STAC Coordinator — algorithm picks a proposed candidate,
      the dedicated ST supervisor approves before the TM is notified.
    </p>
  </div>

  <form method="POST" use:enhance>
    <STPostingForm
      areas={data.areas}
      selectedAreaId={data.selectedAreaId}
      lockArea
      qualifications={data.qualifications}
      error={form?.error ?? null}
    />
  </form>
</div>
