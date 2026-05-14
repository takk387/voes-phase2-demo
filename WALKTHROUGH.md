# VOES Phase 2 — Stakeholder Demo Walkthrough

**Audience:** Joint Committee, plant management, local Union, ideas-program reviewers.
**Length:** 20 minutes if you click through everything; 10 if you skip the open-ended exploration at the end.
**Setup:** Browser open to the demo URL. Default persona is Newman (Team Member, Paint 2nd — final mode). State should be freshly seeded; if not, run `npm run seed` to reset.

The walkthrough follows the order an OT opportunity flows through the system: a TM checks their standing, a Supervisor posts and runs the rotation, errors and edge cases get handled, and the periodic operations (cutover, zero-out, structural changes) happen on a longer cadence. Pause for questions at any of the marked moments.

---

## 1. The Team Member's view (3 min)

**Persona:** Newman, L. — Team Member, Paint 2nd shift, final mode. _Default on first open._

**Notification preferences (first-login beat — 30 sec):**

When the page first loads you get a one-time modal: "How should we reach you?" In-app is required and checked; SMS and email are listed but greyed out as "channel not configured in this demo." Click **Save preferences**. The choice is recorded in the audit log.

> Per the spec's notification policy, the system never reaches a TM off-site by default. Offers appear in the app; off-site channels are opt-in if and when they're wired up. The TM controls the channel — not the Supervisor, not Admin.

**What to show:**

- **Dashboard** — Newman's standing in Paint 2nd: **hours offered / accepted / worked** (final mode shows hours, not cycle/opportunity counts).
- Standing card explanation: "The next opportunity goes to the qualified TM with the lowest hours offered."
- Click **"View full area equalization list"** — every TM in Paint 2nd sorted by hours offered, lowest first, with Newman at top (32h) and a "next up" badge.

**Talking points:**

- A Team Member can check their own standing from any device, any time, including from outside the plant.
- The full area list is visible to every TM in the area — no information asymmetry between Supervisor and TMs.
- Today, doing this requires walking to the area's whiteboard or asking the Supervisor.
- This is final mode — hours-based equalization. Per §22.2, this is the operating expectation: hours-from-day-1, with an implementation grace agreement during initial rollout.

**Pause:** _Any questions about the TM experience?_

---

## 2. Switch to Adams — the interim pathway (1 min)

**Persona:** Adams, R. — Team Member, BA2 1st shift, interim mode.

The notification modal appears again — this is a different TM logging in for the first time. Save and continue.

**What to show:**

- Adams's dashboard now shows **cycle / position / opportunities offered**, not hours.
- Recent offers card — yesterday's stay-over, "You said: YES."
- Area equalization list sorted by seniority, with cycle-offered indicators per TM.

**Talking points:**

- Two equalization modes: **final** (hours-based, what Paint 2nd uses) and **interim** (opportunity-based, what BA2 1st uses).
- The contract anticipates both. The system supports both. The cutover from interim to final is a defined, auditable event.
- Per §22.2, the parties have agreed to skip interim mode in production — hours-from-day-1 is the operating expectation. The system retains interim because the contract explicitly anticipates it, and because §22.2 still needs Joint Committee ratification. If something changes, the pathway is here.

---

## 3. Posting an opportunity (3 min)

**Persona:** Liu, K. — Supervisor for Paint 2nd shift.

**What to show:**

1. Switch persona via header dropdown.
2. Land on the Supervisor dashboard. Two areas: Paint 2nd (final), Finish 2nd (interim).
3. Click **"Post new opportunity"** for Paint 2nd.
4. Fill the form: Saturday stay-over, 4 hours, 1 volunteer needed, no qualification, criticality = Critical. Submit.
5. Land on the **rotation runner** — the system has selected Newman (lowest hours) and is presenting the offer for the supervisor to confirm.

**Highlight the dual-path callout:**

> "Newman has been notified — they can respond from the team-member app on their own. Use the buttons below only when recording a verbal response, marking unavailable, or when contact can't be made."

**Choose one path to demonstrate:**

- **Path A (TM-direct):** Switch to Newman persona, see the offer waiting on the dashboard with Yes / No buttons, click Yes, return to Liu's view to see the response come in.
- **Path B (verbal):** Click "Record YES (verbal)" as Liu. Same outcome, different audit trail (`recorded_via: supervisor_on_behalf` vs `team_member`).

**Talking points:**

- Both paths exist as first-class flows. The plan §11.1 (TM-3) and §11.2 (SV-3 / SV-4) anticipate both.
- The `recorded_via` field captures which path was used. A reviewer can later see "Newman responded directly via the app" or "Liu entered Newman's verbal yes."
- The rotation engine cites which Procedure it used (Procedure B for final mode, Procedure A for interim).

---

## 4. The criticality split — escalation (4 min)

This is the centerpiece of §22.1. There are two branches:

**Setup:** Switch to Liu and post a 1-volunteer opportunity in **Finish 2nd** (the small 8-TM area). Set criticality = Critical. Then on the rotation runner, click "Record NO" repeatedly until the eligible pool is exhausted (8 NOs).

**Critical OT:**

- The runner now shows **"Eligible pool exhausted — 1 short"** with an **Initiate mandatory escalation** button.
- Click it. The system tries ask-high (everyone's already responded, so 0 ask-high offers). Skip to **Execute force-low**.
- Provide a reason ("parts shortage on line"). The system force-assigns the most junior eligible TM (Pope) and marks the posting satisfied.
- Outcome: `satisfied_force_low`. Charge applied for Pope.

**Reset and post again with criticality = Non-essential:**

- Same shortfall flow: 8 NOs, eligible pool exhausted.
- The runner now shows a different option: **Canvas adjacent units**.
- Click it. The system creates ask-high offers for qualified TMs in adjacent areas (BA2 1st + Paint 2nd + Battery 1st) — 36 cascade offers in this seed.
- If those exhaust without takers, the **Abandon posting** button appears.

**Talking points:**

- Round 1 union position: critical OT can force; non-essential OT cannot. The system branches on a `criticality` field set at posting time.
- The branching is contractually conservative — the union opts in to forcing only for work that genuinely cannot wait.
- Every escalation produces a `mandatory_escalation_event` with branch and outcome. Visible in the audit log and the compliance summary.

**Pause:** _Any questions about the critical / non-essential split?_

---

## 5. Bypass remedy (2 min)

**Setup:** Switch to Garcia (Supervisor for BA2 1st + Battery 1st). Click "Flag bypass" in the dashboard.

**What to show:**

1. Pick BA2 1st as the area.
2. Pick Hansen (position 11) as the affected TM.
3. Cause: "Mis-read rotation list, skipped Hansen."
4. Submit. Hansen now has an open remedy.
5. Switch to Hansen persona, see the remedy notice on the dashboard: "You're queued for the next eligible opportunity in BA2 1st shift."
6. Switch back to Garcia, post a new opportunity in BA2 1st.
7. The rotation runner picks Hansen — **NOT** Davis (the normal next-up at position 4) — with an amber "Bypass remedy" callout explaining precedence.

**Talking points:**

- Per CBA §5.14 / §10.17, bypass errors are remedied with the next available assignment, **not pay**. The system enforces that.
- Hansen's offer takes precedence; once she gets _any_ response (Yes / No / skip), the remedy is satisfied. The remedy doesn't depend on her saying yes.
- Remedies persist until satisfied. There is no time-based expiration — the contract protects the affected TM's position indefinitely. Administrative closure applies only if the TM becomes ineligible (separation, permanent transfer out, permanent qual loss); the system surfaces those cases, the parties decide.

---

## 6. Mode cutover — dual approval workflow (3 min)

**Persona:** Okonkwo, E. — Admin.

**What to show:**

1. On the Admin dashboard, see the four areas with their current modes. Paint 2nd and Battery 1st are in final mode (the operating expectation per §22.2); BA2 1st and Finish 2nd are in interim mode (the contract-anticipated alternative). We'll demonstrate cutover on Finish 2nd — the smaller area, simpler to follow.
2. Click **"Initiate cutover →"** on Finish 2nd. Land on the Approval queue with the cutover pending.
3. Switch to **Williams (Plant Mgmt)**. Notice the **amber banner at the top of every page**: "Company approval needed — 1 action awaiting your sign-off."
4. Click into Approvals, click "Approve as Plant Mgmt." Banner disappears for Williams.
5. Switch to **Rodriguez (Union Rep)**. The same banner now appears: "Union approval needed — 1 action awaiting your sign-off."
6. Click into Approvals, click "Approve as Union." Cutover **executes automatically**.
7. Switch back to Admin. Finish 2nd is now in final mode with a "first cycle" badge.
8. Switch to Liu (Supervisor for Paint 2nd + Finish 2nd), post in Finish — the runner picks Howard (most senior, hire 2011), with a **"first cycle after cutover"** explanation: "offers go in seniority order until every member has been offered."

**Talking points:**

- Three different roles are involved in a single dual-approval action. None of them can do it alone.
- The amber banner is **role-aware**: Union Rep sees it only when their side is pending, Plant Mgmt only when theirs is pending. **Admin sees no banner** — admin initiates but cannot approve, by design.
- The first-cycle-after-cutover override matches PS-036's literal text: "new opportunities will be offered first in seniority order, and thereafter by low hours."
- After Howard and the rest of the Finish 2nd cast have been offered once, the flag flips automatically to false and Procedure B (lowest hours first) takes over.
- Production won't typically run a cutover from interim to final — §22.2 has the parties skipping interim. The system retains this pathway because the contract anticipates it and because §22.2 still needs Joint Committee ratification.

**Pause:** _Any questions about dual approval?_

---

## 7. Audit log + grievance support (2 min)

**Persona:** Rodriguez (Union Rep).

**What to show:**

1. Land on the audit log — every action that just occurred in the demo, hash-chained.
2. Filter by area (BA2 1st), then by employee (Hansen). See the full history of every offer, response, charge, and remedy involving Hansen.
3. Click **"Export CSV (grievance package)"**. A CSV downloads. The export itself is logged in the audit trail with the SHA-256 of the CSV body — so a grievance package's integrity can be verified against the system later.

**Talking points:**

- Per §11.4 Flow UR-2 / UR-3, the Union representative pulls audit data without filing an information request to the Company. There is no asymmetry.
- The hash chain makes the log tamper-evident: any modification to a past entry breaks the chain at that point.
- The grievance export is itself logged: who exported, what filters were used, what the body hash was. So if a later party claims to have a "VOES grievance package," its provenance is verifiable.

---

## 8. Reports (2 min)

Click into **Reports** from the footer.

**Walk through each card briefly:**

- **Compliance summary** — auto-generated CBA-fidelity checks: hash chain, cycle integrity, escalation branch fidelity, remedy eligibility, dual approvals, leave preservation. Each check cites its CBA reference. This is what a Joint Committee meeting packet leads with.
- **Fairness distribution** — per-area mean / max / max deviation. Areas where any TM deviates more than 10% from the area mean are flagged amber.
- **Qualification gap** — per area, qualified TMs vs. qual-required posting volume. Surfaces capacity constraints for the Joint Training Committee. Does **not** name individuals.
- **Flex day usage** — per shift, mandatory Flex-day count vs. the 24-day annual cap. Per §22.5, voluntary OT is excluded. Track-and-surface only by default; Joint Committee can switch to enforce.

**Talking points:**

- These are read-only. None of them modify equalization state.
- The thresholds and behaviors here are policy decisions: the Joint Committee can adjust the 10% deviation, the 24-day cap behavior, retention windows, etc. The system carries the defaults until the parties say otherwise.

---

## 9. Open questions to surface (open-ended)

The system surfaces **6 policy-decision items** in plan §22. Four have agreed union positions awaiting formal Joint Committee ratification; two remain genuinely open. A short list to flag during the demo:

**Awaiting Joint Committee ratification (positions agreed):**
- §22.1: Escalation criticality split (critical → force-low / non-essential → cascade then abandon)
- §22.2: Skip interim mode; hours-from-day-1 with implementation grace
- §22.3: Always reverse charges on posting cancellation
- §22.5: 24-day Flex cap applies to mandatory Flex days only; voluntary OT excluded

**Genuinely open:**
- §22.4: Sub-department escalation event format and approval flow
- §22.6: Specialty position carve-out scope (and whether Skilled Trades needs a separate native system)

---

## 10. Wrap-up

The system is tracking every voluntary OT opportunity from posting through offer, response, and (where applicable) work, with a tamper-evident audit log read by both Company and Union. It supports both contractually-anticipated equalization modes and the cutover between them. It branches escalation per the union's round 1 critical-vs-non-essential proposal. It enforces dual approval where the contract calls for joint authorization. It produces compliance and fairness reports auto-generated from operational data.

This is a **demonstration**. Production deployment is the receiving organization's project — Phase 3 will produce the reference implementation suitable for handoff.

For questions during the review window, contact the originator through the ideas-program channel. The system is designed to be sufficient on its own; the spec answers most operational questions.
