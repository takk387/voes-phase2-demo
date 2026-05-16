<!--
  Shared ST posting form. Used by /coord/post (STAC Coordinator across areas)
  and /skt-tl/post (SKT Team Leader for a single area). The originating page
  picks its own form action target; this component only renders the inputs.

  Fields differ from the production /sv/post form:
    - Expertise group selector (Electrical / Mechanical)
    - required_classification dropdown (Electrician / Millwright / etc.)
    - Hard quals AND soft (preferred) quals — soft quals influence sort order
      in the ST rotation, never gate
    - pay_multiplier (1.0 / 1.5 / 2.0)
  The submit creates posting with pending_sv_approval=1 — the server action
  runs the algorithm and a proposed offer lands awaiting SV approval.
-->
<script lang="ts">
  interface AreaOption { id: string; name: string; }
  interface QualOption { id: string; name: string; }

  interface Props {
    /** Areas in the originator's scope. */
    areas: AreaOption[];
    /** Pre-selected area id (e.g. from ?area= query). */
    selectedAreaId?: string;
    /** Lock the area selector to selectedAreaId (used by SKT TL single-area). */
    lockArea?: boolean;
    /** All qualifications — used for both hard + soft quals. */
    qualifications: QualOption[];
    /** Form error text from a server action. */
    error?: string | null;
  }

  let { areas, selectedAreaId, lockArea = false, qualifications, error = null }: Props = $props();

  // Default work date to tomorrow.
  const tomorrow = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  })();
</script>

<div class="card">
  <div class="card-body space-y-4">
    {#if lockArea && selectedAreaId}
      <input type="hidden" name="area_id" value={selectedAreaId} />
      <div>
        <span class="label">Area</span>
        <p class="text-sm font-medium">
          {areas.find((a) => a.id === selectedAreaId)?.name ?? selectedAreaId}
        </p>
      </div>
    {:else}
      <div>
        <label for="area_id" class="label">Area</label>
        <select id="area_id" name="area_id" class="input" required>
          {#each areas as a}
            <option value={a.id} selected={a.id === selectedAreaId}>{a.name}</option>
          {/each}
        </select>
      </div>
    {/if}

    <div class="grid sm:grid-cols-2 gap-4">
      <div>
        <label for="required_expertise" class="label">Expertise group</label>
        <select id="required_expertise" name="required_expertise" class="input">
          <option value="">— any expertise —</option>
          <option value="Electrical">Electrical</option>
          <option value="Mechanical">Mechanical</option>
        </select>
        <p class="text-xs text-ink-500 mt-1">
          Filters the candidate pool by area_of_expertise. Leave blank if the
          posting is open to any ST classification.
        </p>
      </div>
      <div>
        <label for="required_classification" class="label">Classification (optional)</label>
        <select id="required_classification" name="required_classification" class="input">
          <option value="">— any classification —</option>
          <option value="Electrician">Electrician</option>
          <option value="Millwright">Millwright</option>
          <option value="ToolMaker">ToolMaker</option>
          <option value="PipeFitter">PipeFitter</option>
        </select>
        <p class="text-xs text-ink-500 mt-1">
          Narrower than expertise — e.g. "PipeFitter only" excludes Millwrights.
        </p>
      </div>
    </div>

    <div class="grid sm:grid-cols-3 gap-4">
      <div>
        <label for="ot_type" class="label">OT type</label>
        <select id="ot_type" name="ot_type" class="input">
          <option value="voluntary_daily">Daily / stay-over</option>
          <option value="voluntary_weekend">Weekend</option>
          <option value="voluntary_holiday">Holiday</option>
          <option value="late_add">Late-add</option>
        </select>
      </div>
      <div>
        <label for="pay_multiplier" class="label">Pay multiplier</label>
        <select id="pay_multiplier" name="pay_multiplier" class="input">
          <option value="1.0">1.0× — straight time</option>
          <option value="1.5" selected>1.5× — time-and-a-half</option>
          <option value="2.0">2.0× — double time</option>
        </select>
        <p class="text-xs text-ink-500 mt-1">
          Per SKT-04A, hours charged = duration × multiplier.
        </p>
      </div>
      <div>
        <label for="criticality" class="label">Criticality</label>
        <select id="criticality" name="criticality" class="input">
          <option value="critical">Critical</option>
          <option value="non_essential">Non-essential</option>
        </select>
        <p class="text-xs text-ink-500 mt-1">
          ST never force-lows; criticality is informational here.
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
        <input id="start_time" name="start_time" type="time" class="input" required value="07:00" />
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

    {#if qualifications.length > 0}
      <div class="grid sm:grid-cols-2 gap-4">
        <div>
          <span class="label">Required qualifications (hard gate)</span>
          <div class="space-y-1 max-h-40 overflow-y-auto border border-ink-200 rounded p-2">
            {#each qualifications as q}
              <label class="flex items-center gap-2 text-sm">
                <input type="checkbox" name="hard_qualifications" value={q.id} class="rounded" />
                {q.name}
              </label>
            {/each}
          </div>
          <p class="text-xs text-ink-500 mt-1">
            TMs missing any of these are excluded from the pool.
          </p>
        </div>
        <div>
          <span class="label">Preferred qualifications (soft, sort tiebreak)</span>
          <div class="space-y-1 max-h-40 overflow-y-auto border border-ink-200 rounded p-2">
            {#each qualifications as q}
              <label class="flex items-center gap-2 text-sm">
                <input type="checkbox" name="soft_qualifications" value={q.id} class="rounded" />
                {q.name}
              </label>
            {/each}
          </div>
          <p class="text-xs text-ink-500 mt-1">
            More matches breaks ties between candidates with equal hours.
            Never excludes a candidate.
          </p>
        </div>
      </div>
    {/if}

    <div>
      <label for="notes" class="label">Notes (optional)</label>
      <textarea id="notes" name="notes" rows="2" class="input"
                placeholder="Context for the supervisor approving + the TM receiving"></textarea>
    </div>

    {#if error}
      <p class="text-sm text-red-700">{error}</p>
    {/if}

    <div class="bg-amber-50/60 border border-amber-200 rounded p-3 text-xs text-amber-900">
      <span class="font-medium">Note:</span> The algorithm picks the lowest-hours
      eligible journeyperson as a proposed offer. The dedicated ST supervisor for
      this area approves the posting before the TM is notified.
    </div>

    <div class="flex justify-end gap-3 pt-2 border-t border-ink-200">
      <button type="submit" class="btn-primary">Post → send to SV for approval</button>
    </div>
  </div>
</div>
