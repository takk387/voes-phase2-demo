# VOES Phase 2 — Skilled Trades Demo Walkthrough

This demo walks through the Skilled Trades flow (SKT-04A) — a second `area_type` on the same VOES platform, dispatching to a different rule set from production OT. Every feature exists because the contract demands it or the parties have agreed to it. For the production-OT walkthrough, see [WALKTHROUGH.md](WALKTHROUGH.md).

## What this demo shows

- **Hours-of-pay charging (1.0× / 1.5× / 2.0×)** — equalization counts pay hours, not clock hours; multiplier weighting is contractually explicit. (SKT-04A pages 215-216)
- **Equalization unit = shop × shift × area_of_expertise** — Electricians equalize against Electricians, Mechanicals against Mechanicals; not pooled across expertise. (SKT-04A page 215)
- **Classification targeting (Electrician, Millwright, ToolMaker, PipeFitter)** — postings can target the specific trade or the broader expertise group. (SKT-04A page 215; round-2 union meeting clarification)
- **Soft-qual preference (welding, high-lift, confined-space)** — peripheral certs sort candidates but never exclude. (Round-2 clarification)
- **8 SKT-04A shift patterns rendered as pixel-accurate calendars at `/admin/patterns`** — the system's understanding of the rotation math is visible and checkable side-by-side with the contract pages, not narrated. (SKT-04A pages 215-217)
- **Schedule-aware eligibility via cycle math (D / N / A / RDO from pattern + crew_position + cycle anchor)** — rotating-shift workers can't be called for OT on a day they're working a conflicting shift; the system reads this from the pattern, not from a manually-set "this week" flag. (SKT-04A pages 215-217; Option C integration decision)
- **7-day strip + "Next 4 weeks" + "Last 4 weeks" calendar on TM dashboard** — forward view for offer eligibility, backward view for grievance reconstruction. Same cycle math both directions. (SKT-04A; spec §11.1)
- **Apprentice gating** — apprentices receive offers only after all journeypersons in their expertise have been offered in the current cycle. (SKT-04A page 215)
- **Graduated apprentice "Highest plus 1 hour" placement** — newly-graduated journey doesn't land as next-up the day they cross over. (SKT-04A graduated-apprentice clause; Phase 2 seeds manually, Phase 3 automates)
- **SKT TL and STAC Coordinator as origin roles** — ST work is initiated by the trades crew lead or STAC-designated coordinator, not the Supervisor. (SKT-04A page 211 item 5: "STAC may designate hourly coordinators"; round-2 clarification)
- **Dedicated ST Supervisor per area approves before the offer goes live** — SV signs off on whether the posted work is legitimate before TMs are pulled in to respond. Production SVs do not pick up ST scope. (Round-2 clarification)
- **Inter-shop canvass as a normal option, not an escalation** — skilled classifications are scarce per shop; crossing shop boundaries within the same shift is expected. (SKT-04A page 216)
- **Apprentice escalation when journey pool exhausts — NO force-low for ST** — forcing in ST is an untested contractual interpretation; demo defaults to no force; grievance procedure handles disputes. (SKT-04A is silent on force authority for ST; round-2 clarification; Critical Rule #4 in the implementation plan)
- **+1 hour no-show penalty on volunteered RDO / weekend / holiday OT** — penalty for accepting volunteer work and then not showing. Captured at offer creation via `eligibility_at_offer` so no clock-drift risk. (SKT-04A page 216)
- **Reverse-selection "go home" — highest-hours released first** — the worker most equalized to the work is released first when scope shrinks; lower-hours workers retain the assignment. (SKT-04A)
- **Notification policy: no home contact except documented emergency, Union notified** — stricter than PS-036's in-app-default + opt-in off-site. (SKT-04A; round-2 clarification on emergency-exception flow)
- **Annual zero-out at January** — calendar-year reset specific to ST. (SKT-04A)
- **30-day charge challenge window** — disputes filed within 30 days of the charge. (SKT-04A)
- **Full Union Rep audit access including TM "Last 4 weeks" schedule reconstruction** — same read-equity for ST as for production; reconstruction reads the same source the engine reads at offer time. (Spec §11.4; round-2 clarification)
- **4 ST-specific compliance checks (9-12) alongside the 8 production checks** — apprentice gating, no force-low (runtime safety net), multiplier matching, SV-approval-non-bypassable. (SKT-04A; round-2 Critical Rules; spec §16)

State should be freshly seeded; click **Reset demo** in the footer if not. The sections below take the reviewer through each feature in roughly the order an ST OT opportunity flows through the system. Pause for questions at any of the marked moments.

---

## 1. The Skilled Trades Team Member's view (3 min)

**Persona:** Vasquez, R. — Electrician journeyperson, Body Shop ST 1st shift, fixed day pattern.

**Notification preferences (first-login beat — 30 sec):**

When the page first loads you get the same one-time notification preferences modal as production. In-app is required and checked; SMS and email are listed but greyed out as "channel not configured in this demo." Click **Save preferences**.

> Above the offer card you'll see an **amber callout**: "Per SKT-04A, the Company will not contact you at home for this opportunity. Respond here in-app or you'll be marked no-contact." This is the SKT-04A `notification_policy='in_app_only_no_home_except_emergency'` setting — stricter than production's default. The Union is notified if the Company invokes the emergency exception.

**What to show:**

- **Dashboard** — Vasquez's standing in Body Shop ST 1st:
  - **Classification:** Electrician
  - **Area of expertise:** Electrical
  - **Hours offered / accepted / worked** — multiplier-weighted (a 4-hour Saturday OT at time-and-a-half charges as 6 hours).
  - **8 hours offered** — the lowest in the Body Shop Electrical group, so Vasquez is the next-up Electrician for general Body Electrical OT.
- **7-day calendar strip** below the standing card: Mon-Fri shown as **D** (blue), Sat-Sun as **RDO** (light grey). Today (Thursday) is highlighted with a darker border.
- Click **"View full area equalization list"** — every TM in Body Shop ST 1st sorted by hours offered, with Electrical and Mechanical grouped separately. Vasquez at top of Electrical (8h), apprentice Okonkwo, J. at bottom of Electrical (24h, gated).

**Talking points:**

- ST equalization tracks **hours-of-pay**, not raw hours. The standing reflects what the contract calls "hours offered" in pay terms — a 4h Sat OT at 1.5× shows as 6.0 hours offered, not 4.0. SKT-04A pages 215-216.
- ST runs in final mode from day one. There is no interim opportunity-counting mode for Skilled Trades — the contract's equalization model is hours-based by classification.
- Equalization unit = **shop × shift × area_of_expertise**. Vasquez is equalized against other Electricians in Body Shop 1st (Collins-E, apprentice Okonkwo-J), not against Millwrights or PipeFitters in the same shop.
- The "we won't call you at home" rule comes straight from SKT-04A. The TM is responsible for checking the app; the system makes that explicit so there are no "I never got the call" disputes.

**Pause:** _Any questions about the ST team-member experience?_

---

## 2. Rotating-shift Team Members — the calendar visuals (5 min)

**Persona:** Singh, E. — Electrician, Battery Shop ST, 4-Crew 12-hour rotating schedule.

**What to show:**

1. Switch to Singh-E via the header persona switcher.
2. Standing card shows hours, classification (Electrician), expertise (Electrical), and the soft qual **Welding** badge.
3. **7-day calendar strip** shows this week: Singh is on **D-Crew week** — 12-hour day shifts. Today (Thursday) highlighted.
4. Expand **"Next 4 weeks"** — full 28-day grid. Singh's progression over the 4-week cycle: D-shifts → N-shifts → RDO → D-shifts. The visual confirms the rotation math is real, not narrated.
5. Expand **"Last 4 weeks"** — same 28-day grid for the four weeks BEFORE today. Useful for grievance reconstruction. Computed from the same cycle math (negative day-delta, positive modulo) — no separate data source.

**Switch to Larsen-W (currently RDO):**

6. Switch to Larsen, W. — ToolMaker on the same Battery rotating pattern, but **Crew 2**. Calendar this week shows **RDO** all 7 days. Next week he picks up D-shifts; the rotation continues.
7. Talking point: Larsen is **eligible to volunteer** for weekend or holiday OT this week (he's on RDO designation) — that's the `on_rdo_volunteer` eligibility path. We'll come back to this in Section 8 for the no-show penalty.

**Switch to Iqbal-ST (currently N-Crew):**

8. Switch to Iqbal, S. — also an Electrician on the Battery rotating pattern, but **Crew 3**. Calendar shows **N** Mon-Fri this week — 12-hour night shifts.
9. Talking point: If an ST OT posting goes up today for a **day-shift** slot, Iqbal is automatically excluded as `shift_conflict`. The audit log records the skip with the reason. He's not invisible — the system knows about him, but the calendar math says he's working nights this week and can't physically be on day shift.

**Switch to Admin and click /admin/patterns:**

10. Switch to Okonkwo, E. (Admin). Click **Shift Patterns** from the admin dashboard.
11. **/admin/patterns** lists all 8 SKT-04A shift patterns from CBA pages 215-217:
    - Fixed Day, Fixed Evening, Fixed Night (single-crew, 7-day cycle)
    - 1-Crew Weekend (14-day cycle, "Working Every Other Monday")
    - 2-Crew Fixed D/N and 2-Crew Fixed D/Afternoon (14-day cycle)
    - 4-Crew 12-Hour Rotating (28-day cycle, **the big one**)
    - 4-Crew 12-Hour Fixed (14-day cycle)
12. Click into **4-Crew 12-Hour Rotating** — the calendar grid renders the full 28-day cycle for all 4 crews, colored D / A / N / RDO. Per-crew totals show D and N counts.
13. **Side-by-side with `cba_pages/page_216.png`** if reviewers want pixel-by-pixel confirmation that the system models the contract pattern exactly.

**Talking points:**

- Every ST employee is on one of these 8 patterns. The rotation engine reads the pattern + crew position + cycle anchor date and computes the designation (D / N / A / RDO) for any work date — past, present, or future. There is no manually-set "this week" designation; the math is the truth.
- The 4-Crew 12-Hour Rotating pattern has an **asymmetric Crew 4** (more N than D over the 28-day cycle) — that's what the contract specifies. The per-crew totals on the admin preview make this visible without having to count cells.
- **Schedule reconstruction at grievance time:** because the calendar is computed, the Union Rep can ask "what shift was Larsen-W on three Tuesdays ago when this offer was made?" and the system answers from the same cycle math used at offer creation. No paper schedule pulls, no HRIS lookups. Section 11 walks through this.
- Phase 3 swaps the in-memory pattern source for an HRIS feed; the helper interface stays the same, so the downstream UI and audit chain are unchanged.

**Pause:** _Any questions about the shift-pattern integration?_

---

## 3. The apprentice view (2 min)

**Persona:** Okonkwo, J. — Electrical apprentice, Body Shop ST 1st, fixed day pattern.

**What to show:**

- Standing card shows **classification: Apprentice (Electrical)** with an apprentice badge.
- Hours line shows **24 hours offered** — strictly higher than both Body Electrical journeypersons (Vasquez 8h, Collins-E 20h).
- An info callout on the standing card explains the gating: **"You're eligible to receive OT offers once every journeyperson in your expertise group has been offered at least once in the current cycle."**
- 7-day calendar strip the same as Vasquez (fixed day pattern, Mon-Fri D, Sat-Sun RDO).

**Talking points:**

- Apprentice gating is the SKT-04A page 215-216 rule. Apprentices don't compete head-to-head with journeypersons for routine voluntary OT — journey is asked first. Once all journeys in the apprentice's own expertise have been offered (regardless of whether they said yes or no), gating naturally lifts and the apprentice enters the candidate pool.
- The "Highest plus 1 hour" placement principle from SKT-04A's graduated-apprentice clause is why the seed gives apprentices higher starting hours than the journey lowest — when an apprentice graduates, their hours-offered total starts at one hour above the highest journey in their new classification, so they're not next-up the day they cross over. Phase 2 seeds this manually; the event-triggered automation is a Phase 3 polish item.
- Cross-expertise: a Mechanical apprentice is **not** gated by Electrical journeyperson activity. The gating is scoped to `area × area_of_expertise`. The Mechanical apprentices (Davies-R in Body, Stein-M in Paint, Yoon-S in Battery) all gate independently.

---

## 4. SKT TL creates an opportunity (3 min)

**Persona:** Rodriguez, C. — Skilled Trades Team Leader, Body Shop ST 1st.

**What to show:**

1. Switch persona to Rodriguez, C. (Body SKT TL). Land on **/skt-tl** — a single-area dashboard scoped to Body Shop ST 1st only.
2. Expertise group cards: Electrical (2 journey + 1 apprentice), Mechanical (4 journey + 1 apprentice). Lowest-hours next-up TM shown per group.
3. Click **"Post new ST opportunity"** → **/skt-tl/post**.
4. Fill the form:
   - **Area:** Body Shop ST 1st (only area in scope — dropdown is single-option)
   - **Expertise:** Mechanical
   - **Required classification:** PipeFitter
   - **Preferred quals (soft):** Confined-space ✓
   - **Hard quals:** PipeFitter cert (auto-required from classification)
   - **Pay multiplier:** 1.5× (time-and-a-half)
   - **Work date:** Saturday (the upcoming weekend)
   - **Start time:** 06:00 (early-in)
   - **Duration:** 4 hours
   - **Volunteers needed:** 1
   - **Criticality:** Non-essential
   - **Notes:** "Line 4 valve replacement"
   - Submit.
5. Algorithm runs and picks **Park, R.** — the only PipeFitter in Body, who also holds the confined-space soft qual. The page redirects to **/coord/posting/[id]** (the shared rotation runner for ST roles).
6. The header shows an **amber banner: "Awaiting SV approval"**. The proposed assignment card shows Park's name, classification, hours-offered, soft-qual match, and the calendar designation for Saturday (RDO for Park — volunteer-eligible).
7. Response buttons are disabled until SV approval clears.

**Talking points:**

- SKT TL is a distinct role from STAC Coordinator. Both can originate ST postings. The SKT TL operates within a single area (their crew); the STAC Coordinator works across all ST areas. We'll see Davis (STAC Coordinator) in Section 6.
- The **SV approval gate** is the structural difference from production-OT. In production, the SV is the originator; in ST, the SV is the **approver**, downstream of the SKT TL or STAC Coordinator. SKT-04A's intent: the SV signs off on whether the work as posted is legitimate before TMs are pulled in to respond.
- The rotation **runs at posting time** so the proposed assignment is visible to the SV during review. If the SV approves, the offer flips from `proposed` to `pending` and the TM is notified; if rejected, the posting is terminal with the rejection reason logged.
- Notice the soft-qual matching: Park gets selected over a hypothetical PipeFitter without confined-space cert (none exist in this seed, but the preference would apply). Soft quals **never exclude** — a non-holder is still in the pool, just sorted lower when hours are tied.

---

## 5. The dedicated ST Supervisor approves (3 min)

**Persona:** Reeves, T. — Dedicated ST Supervisor, Body Shop ST 1st only.

**What to show:**

1. Switch to Reeves, T. via persona switcher.
2. Land on the SV dashboard, which **branches on role** — Reeves sees the ST view (a single area card for Body 1st ST), not the production view that Garcia and Liu see.
3. **Amber banner across the top:** "1 posting pending your approval." Click **Open approval queue →**.
4. **/sv/approvals** — the ST SV approval queue. Lists every posting in Reeves's scope (only Body 1st ST) with `pending_sv_approval=1`.
5. Each row shows: posting summary, originator (Rodriguez-C, SKT TL), proposed candidate (Park, R., PipeFitter, 20h offered, confined-space soft-qual match), eligibility badge (Sat = RDO = volunteer-eligible), required + preferred quals, originator's note.
6. Click **Approve**. Confirmation banner appears; the queue refreshes and shows the action in the "Recent decisions" card.
7. Switch back to Park, R. (Body ST). The pending offer is now live on his dashboard with the SKT-04A in-app-only callout above the offer card.
8. Click Yes (or No) to respond — the charge applies at the 1.5× multiplier (4h × 1.5 = 6.0h charged).

**Optional: demonstrate rejection.** Set up a second posting from Rodriguez-C, switch back to Reeves, click **Reject with reason** ("Coverage already secured by extended shift"). The posting state flips to `rejected_by_sv` with the reason logged. Rejection is terminal in this demo — rejection-revision (originator edits and resubmits) is a Phase 3 polish item.

**Talking points:**

- **Each ST area has its own dedicated ST Supervisor.** Production SVs (Garcia, Liu) do not pick up ST scope and do not see ST approval queues — this matches the round-2 union meeting position. Switch to Garcia and the /sv/approvals route redirects out; Garcia's dashboard shows only the production areas (BA2 1st, Battery 1st production side).
- The approval gate is **non-bypassable**. Recording a response on a proposed offer returns a 400 error and writes an audit entry. Compliance check 12 (Section 12) is the runtime safety net.
- The "Recent decisions" card filters out the synthetic bootstrap approvals (which exist so historical seeded data satisfies compliance check 12 cleanly). What the SV sees are real operational approvals and rejections, not seed noise.

**Pause:** _Any questions about the SV approval gate?_

---

## 6. STAC Coordinator working across ST areas (3 min)

**Persona:** Davis, A. — STAC-designated Skilled Trades Coordinator. Scope: all 3 ST areas (Body, Paint, Battery rotating).

**What to show:**

1. Switch to Davis, A. (STAC Coordinator). Land on **/coord** — multi-area dashboard with one card per ST area. Each card shows expertise-group counts, apprentice counts, and the lowest-hours next-up TM per expertise.
2. Click **"Post new ST opportunity"** → **/coord/post**. Same form as /skt-tl/post but with a multi-area dropdown.
3. Compose a Paint Shop ST 1st PipeFitter need: 4h Saturday early-in at 1.5×.
4. Submit. The rotation engine finds **no PipeFitter in Paint Shop ST 1st** — the seed has 1 Electrician + 4 Mechanical in Paint but no PipeFitter classification.
5. **Inter-shop canvass triggers automatically** because `allow_inter_shop_canvass=1` and the in-area pool is empty. Algorithm extends to other ST areas of the same expertise and shift, finds Park, R. in Body Shop ST 1st, picks him.
6. The proposed offer is tagged **`phase='inter_shop_canvass'`** — visible as a badge on /coord/posting/[id] and in the audit log.
7. Becker, A. (Paint ST SV) gets the approval queue entry — the SV scope follows the posting's source area, not the candidate's home area.

**Talking points:**

- Inter-shop canvass is a **normal canvassing option** for SKT-04A, not an escalation. The Skilled Trades classifications are scarce enough at any single shop that crossing shop boundaries is expected — only one or two PipeFitters per shop, for example.
- The canvass stays within shift. A Paint 1st posting canvasses other 1st-shift ST shops, not the 2nd-shift areas. (None exist in this seed for ST — Battery rotating's "shift" field is a placeholder; the rotating pattern is its own time structure.)
- Hours snapshot for the lowest-hours sort comes from each candidate's **home area**, not the posting area — Park's 20h-offered in Body is what gets compared, so the equity in the source area is preserved.

---

## 7. Apprentice escalation — no force-low for ST (4 min)

**Persona:** Davis, A. (STAC Coordinator). Stay on this persona.

**Setup:** This section walks through a deliberately constrained scenario. The seed and demo today's date (May 14, 2026 — Thursday) place Battery rotating Electricians on these designations: Singh, E. = D-Crew (day shift), Iqbal, S. = N-Crew (night shift), Mahmoud, K. (apprentice) = RDO (Crew 4).

**What to show:**

1. Davis posts a **day-shift Electrician OT** in Battery Shop ST: today or tomorrow, 4 hours, 1.5×, volunteers needed = 1.
2. Algorithm runs:
   - **Iqbal, S.** is excluded immediately — N-Crew this week, `shift_conflict` with a day-shift posting. Audit log records `st_candidate_skipped` with reason `shift_conflict`.
   - **Mahmoud, K.** (apprentice) is gated normally — Iqbal hasn't been offered this cycle, so the journey pool hasn't been exhausted.
   - **Singh, E.** is the only candidate. Algorithm picks Singh, posts pending SV approval.
3. Switch to Ortega, J. (Battery ST SV) → approve.
4. Switch to Singh, E. → click **No**. Charge records hours-offered at 1.5×.
5. Back to Davis. Algorithm runs the next offer:
   - Singh now filtered (already responded `no` on this posting).
   - Iqbal still `shift_conflict`.
   - Mahmoud still apprentice-gated (Iqbal still never offered).
   - **First pass returns no candidates.**
6. **Algorithm escalates.** Second pass runs with apprentice gating disabled. Mahmoud, K. (Crew 4 RDO this week → `on_rdo_volunteer` eligibility for the day shift) is now a candidate. He's selected with **`phase='apprentice_escalation'`** — visible as a badge on the rotation runner and in the audit log.
7. Approve the proposed offer through Ortega. Notify Mahmoud.
8. **If Mahmoud declines too** — the algorithm returns null. The posting stays `open` with a banner: **"Eligible pool exhausted — no force-low per SKT-04A interpretation. Consider grievance procedure if coverage is required."** Audit log records `st_pool_exhausted`.

**Talking points:**

- **No force-low for ST.** SKT-04A doesn't grant the Company the authority to compel a Skilled Trades employee into voluntary OT. The user's union contact confirmed that forcing would be "an untested contractual interpretation" and would be fought via the Grievance Procedure if pursued. Demo defaults reflect "no force" — and the rotation engine **has no code path** that produces `offer.phase='force_low'` for an ST area.
- **Compliance check 10** (Section 12) is the runtime audit safety net: scans for any ST offer with `phase='force_low'` and fails if it finds one. Trivially zero rows on clean data, but the check exists so a regression in the engine would be caught at audit time, not in the field.
- This is structurally different from production OT (PS-036), where the §22.1 critical-vs-non-essential branch authorizes force-low for critical OT after the ask-high pass. SKT-04A's equalization is exhaustive at the eligible-pool level — when the pool runs out, the posting is unfilled and the disagreement, if any, goes to the grievance procedure.
- The **shift-conflict + apprentice-gating combination** is the realistic case for ST escalation: with 2-3 journeys per shop classification and rotating patterns, a single decline plus a single shift conflict can exhaust the journey pool inside a posting day.

**Pause:** _Any questions about ST escalation?_

---

## 8. Schedule-aware no-show penalty (2 min)

**Persona:** Ortega, J. (Battery ST SV).

**Setup:** This shows the +1 hour no-show penalty that SKT-04A applies specifically to RDO-volunteer and weekend/holiday OT.

**What to show:**

1. Have Davis post a Saturday 4-hour ToolMaker OT in Battery (1.5× multiplier). Larsen, W. is the only ToolMaker; algorithm picks him.
2. Approve via Ortega. Larsen gets notified.
3. Switch to Larsen, W. → click **Yes**. Audit log records the response with **`offer.eligibility_at_offer='on_rdo_volunteer'`** (Larsen was on RDO this Saturday — Crew 2 RDO designation for this part of the cycle).
4. Saturday comes and goes. Larsen doesn't show up.
5. Switch to Ortega → /sv → click into the posting → record **No-show** on Larsen's response.
6. The system applies:
   - **Hours offered** charge: 4h × 1.5 = 6.0h
   - **Hours accepted** charge: 4h × 1.5 = 6.0h (Larsen had accepted)
   - **Plus a +1 hour penalty** flagged `is_penalty=1`, charge_multiplier 1.0 (flat) — recorded in the audit log with note "no-show penalty per SKT-04A".
7. Switch to Larsen → standing card now reflects the penalty. Larsen sits a notch higher than he would have otherwise.

**Talking points:**

- The penalty is **specific to RDO-volunteer + weekend/holiday OT**. If Singh-E (currently on D-Crew, working normal day shifts this week) had no-showed a regular daily-OT (an early-in or late-out on his normal week), the penalty would not trigger — the contract's penalty is for volunteered RDO/weekend work where the worker said "yes, I'll come in on my day off" and then didn't.
- The system distinguishes the two scenarios by reading **`eligibility_at_offer`** on the offer row — set at offer creation, persisted, immutable. No re-computation at no-show time, no risk of clock drift.
- Production no-show is treated as a `No` response — no penalty. PS-036 doesn't carry an equivalent provision.
- The penalty charge is **exempt from compliance check 11** (charge multiplier matches posting rate) via the `is_penalty=1` flag — penalties are intentionally flat 1.0×.

---

## 9. Pay multiplier and charge weighting (2 min)

**Persona:** Vasquez, R. (Body ST Electrician).

**What to show:**

1. Switch to Vasquez. Note his current standing: 8 hours offered, 0 accepted.
2. Have Rodriguez-C (SKT TL) post a 4-hour Saturday Electrician OT at 1.5×, then approve through Reeves (Body 1st SV).
3. Vasquez gets the offer. Switch to Vasquez and click **Yes**.
4. Standing updates:
   - Hours offered: 8.0 → **14.0** (added 4 × 1.5 = 6.0)
   - Hours accepted: 0.0 → **6.0**
   - Both charges record `charge_multiplier=1.5` with the posting's `pay_multiplier=1.5`.
5. View the charge detail (click into Vasquez's history on the area equalization page). The audit log shows the multiplier explicitly and the reasoning: "4 hours × 1.5 (time-and-a-half) = 6.0 hours-of-pay charged."

**Talking points:**

- SKT-04A charges in **hours-of-pay**, not raw clock hours. A 4-hour Saturday OT at time-and-a-half "costs" the worker 6 hours of equalization, because that's what they got paid.
- This is structurally different from production OT (PS-036), which charges in raw hours regardless of pay rate. The two area types share a `charge` table but the `charge_multiplier` field is 1.0 for production and 1.0 / 1.5 / 2.0 for ST depending on the posting's pay multiplier.
- Compliance check 11 (Section 12) verifies that every non-penalty, non-reversal ST charge has `charge.charge_multiplier == posting.pay_multiplier` — catches multiplier drift if the engine ever miscomputes.

---

## 10. Release-excess flow — "go home" (2 min)

**Persona:** Davis, A. (STAC Coordinator).

**Setup:** SKT-04A includes a reverse-selection rule: when fewer workers are needed than originally scheduled, **highest-hours workers are released first**. The opposite of normal selection — released workers leave the OT pool first so the lowest-hours workers retain the work they were equalized to.

**What to show:**

1. Davis posts a Battery rotating Mechanical OT, 4 hours, volunteers needed = 3. Algorithm offers to the three lowest-hours Mechanical-eligible candidates (Mwangi-R, Larsen-W, Yoon-S after gating clears, etc.).
2. Approve through Ortega. All three accept.
3. Day-of, scope changes — only 2 workers are actually needed. Davis goes back to **/coord/posting/[id]** and clicks **Release excess workers**.
4. The modal shows the currently-assigned workers sorted by **hours offered descending** (highest first — the reverse of normal selection). Davis enters **count = 1**.
5. The system releases the highest-hours worker. Charges adjust:
   - `hours_accepted` charge reversed (net zero for the release)
   - `hours_worked` charge reversed (net zero)
   - `hours_offered` charge **remains** — they were still offered the slot, and the offer counts toward gating for the cycle
   - Offer status flips to `released`. Audit log records `st_worker_released` with the actor and reason.

**Talking points:**

- The reverse-selection direction is intentional: the worker with the **most** equalization hours has been getting more of the work; they're the right one to step out when scope shrinks, so the lower-hours workers retain the assignment.
- Charge reversal preserves equity — the released worker isn't "punished" with hours-accepted on work they didn't do, but they also aren't refunded the hours-offered (they were genuinely offered and accepted; the cycle counted that). Net effect: the release neutrally adjusts hours-accepted and hours-worked.
- `released` is a distinct offer status from `cancelled` or `abandoned`. Audit log lets a Union Rep trace the reason chain at grievance time.

---

## 11. Union Rep audit access — full ST visibility, including schedule reconstruction (3 min)

**Persona:** Rodriguez, M. — District Committeeperson. Scope extended to **all 7 areas** (4 production + 3 ST).

**What to show:**

1. Switch to Rodriguez, M. (Union Rep). The audit log opens directly; every action taken in the demo so far is visible — including ST postings, approvals, rejections, escalations, no-show penalties, and releases.
2. **Filter by area** — pick "Battery Shop ST (4-Crew Rotating)". The audit log narrows to just Battery ST events.
3. **Filter by employee** — pick "Larsen, W." See the full history of every offer, response, charge, and release involving Larsen.
4. Click into a specific offer — the detail view shows:
   - The posting's pay multiplier
   - The candidate's `eligibility_at_offer` (e.g., `on_rdo_volunteer`)
   - The candidate's **shift pattern + crew position + cycle anchor date** at the time of the offer
   - The computed designation (D / N / RDO) for the work date
5. Click the **"Last 4 weeks"** view on Larsen's TM dashboard (Union Rep can navigate any TM's dashboard within scope). The 28-day grid renders Larsen's shift pattern history.
6. **Grievance reconstruction example:** "Was Larsen on RDO three Tuesdays ago, when this OT offer was made?" — Union Rep reads the date in the grid, sees the designation, doesn't need to ask HRIS or pull paper schedules.
7. **Export grievance package CSV** — same flow as production. The export is logged with SHA-256 of the body, so a grievance package's provenance is verifiable.

**Talking points:**

- **Union read-equity for ST is the same as for production.** No gates, no Company-approval friction. The Union Rep pulls audit data on Skilled Trades the same way they pull on Body / Paint / Battery production. SKT-04A doesn't carve this differently from PS-036; the platform doesn't either.
- The cycle-math reconstruction is the load-bearing piece for ST grievance support. Every shift designation that affected an offer decision is **derivable from the same persistent data** — the pattern row plus the employee's crew position and anchor date. There is no scenario where the audit log says "Larsen was on RDO" and the cycle math says something else — they read the same source.
- Compliance check 12 (Section 12) verifies that every ST offer that received a response had its parent posting approved by the SV. The hash chain on the audit log makes any retroactive edit detectable.
- The same audit retention and export rules apply (10-year retention default, SHA-256 body hashing on export).

**Pause:** _Any questions about audit visibility for ST?_

---

## 12. Compliance summary — 12 checks total, 4 ST-specific (2 min)

**Persona:** Rodriguez, M. (Union Rep). Click **Reports** → **Compliance summary**.

**What to show:**

The compliance report runs 12 checks, each citing its CBA reference. The first 8 are production-side (described in [WALKTHROUGH.md](WALKTHROUGH.md) Section 8). The 4 ST-specific checks:

- **Check 9 — Apprentice gating respected** (SKT-04A page 215). For every non-escalation, non-canvass apprentice offer in an ST area, verifies that all active journeypersons in the apprentice's expertise group have been offered at least once in the current cycle. Allows exceptions for offers tagged `phase='apprentice_escalation'` or `'inter_shop_canvass'`. Bootstrap historical apprentice offers are excluded (they predate the gating mechanism in the demo timeline).
- **Check 10 — No force-low for ST areas ever** (Critical Rule #4 / SKT-04A interpretation). Scans for any ST offer with `phase='force_low'`. Must return zero rows. This is the runtime safety net for the engine's no-force-low contract.
- **Check 11 — Charge multiplier matches posting rate** (SKT-04A hours-of-pay weighting). Every non-penalty, non-reversal ST charge must have `charge.charge_multiplier == posting.pay_multiplier`. Penalty rows (`is_penalty=1`) are exempt — they're intentionally flat 1.0×.
- **Check 12 — All ST offers passed through SV approval** (SV approval gate non-bypassable). Every ST offer in `pending` or `responded` status must have a `'sv_approved_st_posting'` audit entry on its parent posting before any response was recorded.

All 12 checks pass on the fresh seed. **Click "Re-run checks"** — same output. Verifiable on demand.

**Talking points:**

- These are read-only, automatically generated from operational data. The Joint Committee meeting packet leads with this report.
- Each check cites the CBA reference and the query it runs. A reviewer can ask "show me the failing rows for check 11" and the system either returns them or returns nothing.
- The checks scale: adding a new rule (e.g., enforcement on the 24-day Flex cap from §22.5) means a new check entry alongside the existing 12, not a UI rebuild.

---

## 13. Open questions and out-of-scope items (open-ended)

A short list to flag during the demo:

**Specialty positions — §22.6 (production side, not ST):**
- Skilled Trades is fully built into the system as a parallel `area_type` — that's what this walkthrough showed. The §22.6 carve-out scope is now narrower than it was at Phase 1 drafting: it covers **Team Leaders and Equipment Operators staying in the equalization pool** of their assigned production area (they're not sidestepped from rotation), with the carve-out applying **only to their routine before/after-shift specialty tasks** (PS-036's "early-ins/late-outs" exception). How those routine tasks get logged so they're visible without bleeding into rotation totals is still being researched by the user — it's the remaining §22.6 question.

**Separate-but-parallel features (own implementation plan, when scoped):**
- **Outside contractor clearance + outside contracting checklist** — workflow tracking when work is contracted out. Not part of SKT-04A's equalization flow.
- **Staffing availability** — who is available for project work, over which periods (nights only, weekends only, etc.), surfaced at team and member level. Also a distinct feature from equalization.

Both are flagged as separate-but-parallel per the round-2 union meeting; they should get their own implementation plan when the user is ready to scope them. Neither is folded into the SKT-04A work shown here.

**Phase 3 reference-implementation items deferred from this demo:**
- HRIS-fed live schedule data replacing the `DEMO_TODAY` constant and seeded cycle anchor dates (Phase 2 uses an in-memory pattern + manually-engineered anchors; Phase 3 swaps in an HRIS feed behind the same helper interface, downstream UI unchanged).
- Annual zero-out automation (January trigger) for ST areas — current demo handles via the same dual-approval flow as production.
- Emergency-contact-with-Union-notification workflow for the SKT-04A "except documented emergency" exception — Phase 2 surfaces the policy banner; the emergency-exception workflow itself is left for Phase 3.
- Graduated-apprentice "Highest plus 1 hour" placement automation — Phase 2 seeds this manually.
- Rejection-revision workflow (originator revises a rejected ST posting in place) — Phase 2 treats SV rejection as terminal.
- Production final-mode re-offer prevention — Step 4 added an `alreadyRespondedOnPosting()` filter for ST; the production path has the same latent issue on multi-volunteer postings (uncommon case), to be applied symmetrically as a polish item.

---

## Wrap-up

Skilled Trades runs on the same platform as production OT. One data model, one audit log, one persona switcher, one compliance report — with a second `area_type` (`skilled_trades`) that dispatches to SKT-04A's rule set. Apprentice gating, classification + expertise targeting, soft-qual preferences, inter-shop canvassing, the SV approval gate, the +1 RDO/weekend no-show penalty, multiplier-weighted hours-of-pay charging, reverse-selection release, and shift-pattern-aware eligibility (with 28-day calendar reconstruction for grievance support) are all implemented and audited. The four ST-specific compliance checks sit alongside the eight production checks in the same report. Union read-equity for ST data is structural, not policy.

The visual centerpiece is **/admin/patterns** — the SKT-04A shift pattern calendars rendered side-by-side with the contract pages so the system's understanding of the rotation math is checkable, not just narrated. If a reviewer wants pixel-by-pixel confirmation that the demo models the contract correctly, that page is where to look.

This is a **demonstration**. Production deployment is the receiving organization's project — Phase 3 will produce the reference implementation suitable for handoff.

For questions during the review window, contact the originator through the ideas-program channel. The system is designed to be sufficient on its own; this walkthrough and [WALKTHROUGH.md](WALKTHROUGH.md) cover the operational questions; the formal spec (Phase 1) answers the architectural ones.
