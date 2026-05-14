// Demo personas. Phase 2 does not implement real authentication; instead, the
// header carries a persona switcher so reviewers can see the same data through
// each role's lens in a single session. (§21.1: "Multi-role login... with
// role-switching capability so reviewers can see the system from each
// perspective in a single session.")

export type PersonaRole =
  | 'team_member'
  | 'supervisor'
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
    area_scope: ['area-ba2-1st', 'area-paint-2nd', 'area-battery-1st', 'area-finish-2nd'],
    description: 'District Committeeperson. Audit access to all four areas. Approves Union side of dual-approval actions.'
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
  }
];

export function findPersona(id: string | undefined): Persona | undefined {
  if (!id) return undefined;
  return PERSONAS.find((p) => p.id === id);
}

export const DEFAULT_PERSONA_ID = 'tm-newman';
