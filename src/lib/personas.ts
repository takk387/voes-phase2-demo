// Demo personas. Phase 2 does not implement real authentication; instead, the
// header carries a persona switcher so reviewers can see the same data through
// each role's lens in a single session. (§21.1: "Multi-role login... with
// role-switching capability so reviewers can see the system from each
// perspective in a single session.")

export type PersonaRole =
  | 'team_member'
  | 'supervisor'
  | 'st_supervisor'      // dedicated ST area supervisor (approves ST postings)
  | 'skt_coordinator'    // STAC-designated coordinator across ST areas
  | 'skt_tl'             // Skilled Trades Team Leader (single ST area)
  | 'union_rep'
  | 'plant_manager'
  | 'admin';

export interface Persona {
  id: string;                 // stable cookie value
  display_name: string;
  role: PersonaRole;
  // For team_member personas, the employee row this persona represents.
  employee_id?: string;
  // For supervisors and union reps, the area scope (single area for slice 1).
  area_scope?: string[];
  description: string;        // short blurb shown in the switcher
}

export const PERSONAS: Persona[] = [
  {
    id: 'tm-newman',
    display_name: 'Newman, L. (Paint)',
    role: 'team_member',
    employee_id: 'emp-newman-l',
    description: 'Paint 2nd shift — final mode. Lowest hours offered (32), next-up under Procedure B. Default persona for the walkthrough.'
  },
  {
    id: 'tm-fischer',
    display_name: 'Fischer, T. (Battery)',
    role: 'team_member',
    employee_id: 'emp-fischer-t',
    description: 'Battery 1st shift — final mode. Lowest hours offered (30), next-up under Procedure B.'
  },
  {
    id: 'tm-adams',
    display_name: 'Adams, R. (BA2 interim)',
    role: 'team_member',
    employee_id: 'emp-adams-r',
    description: 'BA2 1st — interim mode. Position 1, most senior. Welder + forklift. Said YES yesterday. Shown as the contract-anticipated interim pathway (§22.2 has the parties skipping it in production).'
  },
  {
    id: 'tm-brown',
    display_name: 'Brown, J.',
    role: 'team_member',
    employee_id: 'emp-brown-j',
    description: 'Position 2. No quals. Said NO on yesterday\'s posting.'
  },
  {
    id: 'tm-chen',
    display_name: 'Chen, L.',
    role: 'team_member',
    employee_id: 'emp-chen-l',
    description: 'Position 3. Welder. Said YES on yesterday\'s posting.'
  },
  {
    id: 'tm-davis',
    display_name: 'Davis, M.',
    role: 'team_member',
    employee_id: 'emp-davis-m',
    description: 'Position 4 — next up after the seed. Forklift qualified.'
  },
  {
    id: 'tm-khan',
    display_name: 'Khan, A.',
    role: 'team_member',
    employee_id: 'emp-khan-a',
    description: 'Position 5. Forklift qualified. Hire 2014-03-01 (matches Appendix C.3).'
  },
  {
    id: 'tm-jones',
    display_name: 'Jones, T.',
    role: 'team_member',
    employee_id: 'emp-jones-t',
    description: 'Position 14 — most junior. No quals. Hire 2023-06-07.'
  },
  {
    id: 'sv-garcia',
    display_name: 'Garcia, J. (Supervisor)',
    role: 'supervisor',
    area_scope: ['area-ba2-1st', 'area-battery-1st'],
    description: 'Supervises BA2 1st (interim mode — contract-anticipated alternative) and Battery 1st (final mode). Try posting in Battery to see hours-based selection.'
  },
  {
    id: 'sv-liu',
    display_name: 'Liu, K. (Supervisor)',
    role: 'supervisor',
    area_scope: ['area-paint-2nd', 'area-finish-2nd'],
    description: 'Supervises Paint 2nd (final mode) and Finish 2nd (interim, staged for cutover demo).'
  },
  {
    id: 'ur-rodriguez',
    display_name: 'Rodriguez, M. (Union Rep)',
    role: 'union_rep',
    // Union read-equity for ST is non-negotiable per CLAUDE.md "Sensitive
    // context" — Rodriguez's scope extends to the 3 ST areas alongside the
    // 4 production areas, so audit / compliance visibility is symmetric.
    area_scope: [
      'area-ba2-1st', 'area-paint-2nd', 'area-battery-1st', 'area-finish-2nd',
      'area-body-st-1st', 'area-paint-st-1st', 'area-battery-st-rot'
    ],
    description: 'District Committeeperson. Audit access to all 7 areas (4 production + 3 Skilled Trades). Approves Union side of dual-approval actions.'
  },
  {
    id: 'pm-williams',
    display_name: 'Williams, P. (Plant Mgmt)',
    role: 'plant_manager',
    description: 'Plant Manager. Approves Company side of dual-approval actions (zero-out, mode cutover, structural changes).'
  },
  {
    id: 'ad-okonkwo',
    display_name: 'Okonkwo, E. (Admin)',
    role: 'admin',
    description: 'System administrator. Initiates configuration, integrations, periodic operations.'
  },

  // ==========================================================================
  // Skilled Trades — Team Members (Step 5)
  // ==========================================================================
  // 4 personas in Body Shop ST 1st (fixed_day) + 4 in Battery Shop ST
  // rotating. The Battery personas land on engineered DEMO_TODAY designations
  // via their crew_position (see seed.ts ST_CYCLE_ANCHOR comment).
  {
    id: 'tm-vasquez',
    display_name: 'Vasquez, R. (Body ST)',
    role: 'team_member',
    employee_id: 'emp-vasquez',
    description: 'Electrician, Body Shop ST 1st. Fixed day shift. Lowest-hours Electrical journeyperson in Body — next-up for general Electrical OT.'
  },
  {
    id: 'tm-okonkwo-j',
    display_name: 'Okonkwo, J. (Body ST app.)',
    role: 'team_member',
    employee_id: 'emp-okonkwo-j',
    description: 'Electrical apprentice, Body Shop ST 1st. Gated until both Electrical journeypersons (Vasquez, Collins-E) have been offered this cycle.'
  },
  {
    id: 'tm-bradley',
    display_name: 'Bradley, M. (Body ST)',
    role: 'team_member',
    employee_id: 'emp-bradley',
    description: 'Millwright, Body Shop ST 1st. Holds high-lift soft qual. Lowest-hours Mechanical journeyperson in Body — next-up for general Mechanical OT.'
  },
  {
    id: 'tm-park',
    display_name: 'Park, R. (Body ST)',
    role: 'team_member',
    employee_id: 'emp-park-r',
    description: 'PipeFitter, Body Shop ST 1st. Holds confined-space soft qual. Only PipeFitter in Body — receives PipeFitter postings before inter-shop canvass.'
  },
  {
    id: 'tm-singh-e',
    display_name: 'Singh, E. (Battery ST)',
    role: 'team_member',
    employee_id: 'emp-singh-e',
    description: 'Electrician, Battery rotating, currently D-Crew (Crew 1) week. Welding soft qual. Lowest-hours Battery Electrician — next-up.'
  },
  {
    id: 'tm-iqbal-st',
    display_name: 'Iqbal, S. (Battery ST)',
    role: 'team_member',
    employee_id: 'emp-iqbal-s',
    description: 'Electrician, Battery rotating, currently N-Crew (Crew 3) week. Demonstrates shift-conflict exclusion for day-shift OT this week.'
  },
  {
    id: 'tm-mwangi-r',
    display_name: 'Mwangi, R. (Battery ST)',
    role: 'team_member',
    employee_id: 'emp-mwangi-r',
    description: 'Millwright, Battery rotating, currently D-Crew (Crew 1) week. Lowest-hours Battery Millwright — next-up.'
  },
  {
    id: 'tm-larsen-w',
    display_name: 'Larsen, W. (Battery ST)',
    role: 'team_member',
    employee_id: 'emp-larsen-w',
    description: 'ToolMaker, Battery rotating, currently RDO (Crew 2) week. High-lift soft qual. Eligible to volunteer for weekend / holiday OT (RDO-volunteer path).'
  },

  // ==========================================================================
  // Skilled Trades — Coordinators, TLs, ST Supervisors
  // ==========================================================================
  // STAC Coordinator + SKT TL initiate ST postings; the dedicated ST SV for
  // each area is the approver. Production SVs (Garcia, Liu) do NOT pick up
  // ST scope — Critical Rule #11 in the implementation plan.
  {
    id: 'coord-davis',
    display_name: 'Davis, A. (STAC Coordinator)',
    role: 'skt_coordinator',
    area_scope: ['area-body-st-1st', 'area-paint-st-1st', 'area-battery-st-rot'],
    description: 'STAC-designated Skilled Trades coordinator. Posts ST OT across all 3 ST areas; rotation runs, then SV approval required before TM notified.'
  },
  {
    id: 'tl-rodriguez-st',
    display_name: 'Rodriguez, C. (Body SKT TL)',
    role: 'skt_tl',
    area_scope: ['area-body-st-1st'],
    description: 'Skilled Trades Team Leader, Body Shop ST 1st. Trades-side analog of production TL; can initiate ST postings for their single area, routed through SV for buy-off.'
  },
  {
    id: 'sv-body-1st-st',
    display_name: 'Reeves, T. (Body ST SV)',
    role: 'st_supervisor',
    area_scope: ['area-body-st-1st'],
    description: 'Dedicated Skilled Trades supervisor for Body Shop ST 1st. Approves ST postings originated by Davis (STAC) or Rodriguez-C (SKT TL). Does NOT see production OT.'
  },
  {
    id: 'sv-paint-1st-st',
    display_name: 'Becker, A. (Paint ST SV)',
    role: 'st_supervisor',
    area_scope: ['area-paint-st-1st'],
    description: 'Dedicated Skilled Trades supervisor for Paint Shop ST 1st. Approves ST postings for that area only.'
  },
  {
    id: 'sv-battery-rot-st',
    display_name: 'Ortega, J. (Battery ST SV)',
    role: 'st_supervisor',
    area_scope: ['area-battery-st-rot'],
    description: 'Dedicated Skilled Trades supervisor for Battery Shop ST (4-crew 12h rotating). Approves ST postings for that area only.'
  }
];

export function findPersona(id: string | undefined): Persona | undefined {
  if (!id) return undefined;
  return PERSONAS.find((p) => p.id === id);
}

export const DEFAULT_PERSONA_ID = 'tm-newman';
