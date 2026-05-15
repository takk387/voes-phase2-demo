// preview_patterns.ts — render every SKT-04A shift pattern as an ASCII grid
// to stdout. Used for visual verification against the contract page images
// (`cba_pages/page_215.png` through `page_217.png`).
//
// Run:
//   npm run preview-patterns
//
// Each pattern prints:
//   - header line: name, cycle_length_days, crew_count
//   - calendar grid: rows = crews, columns = day_in_cycle
//   - dividing separator between patterns
//
// This script does NOT touch the database. It reads from the canonical
// ALL_SHIFT_PATTERNS array in `src/lib/server/shift_patterns.ts`, so what's
// printed here is the same data that gets inserted into the shift_pattern
// table at seed time.

import { ALL_SHIFT_PATTERNS } from '../src/lib/server/shift_patterns.js';

const DAYS_OF_WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const COL_WIDTH = 5;
const DESIGNATION_LABEL: Record<string, string> = {
  D: ' D ',
  N: ' N ',
  A: ' A ',
  RDO: 'RDO'
};

function padCell(s: string): string {
  if (s.length >= COL_WIDTH) return s.slice(0, COL_WIDTH);
  const pad = COL_WIDTH - s.length;
  const left = Math.floor(pad / 2);
  const right = pad - left;
  return ' '.repeat(left) + s + ' '.repeat(right);
}

function divider(width: number): string {
  return '─'.repeat(width);
}

function renderPattern(p: typeof ALL_SHIFT_PATTERNS[number]): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(`Pattern: ${p.name}   cycle=${p.cycle_length_days}d   crews=${p.crew_count}`);
  lines.push(`Description: ${p.description}`);

  // Compute weeks (cycle_length_days / 7). The contract patterns are all
  // multiples of 7; if a future pattern isn't, this still degrades gracefully
  // by showing one big row.
  const weekCount = Math.ceil(p.cycle_length_days / 7);

  for (let w = 0; w < weekCount; w++) {
    lines.push('');
    lines.push(`  Week ${w + 1} (days ${w * 7 + 1}-${Math.min((w + 1) * 7, p.cycle_length_days)})`);
    // Day header
    const headerCells: string[] = ['Crew '];
    for (let d = 0; d < 7; d++) {
      const dayIdx = w * 7 + d;
      if (dayIdx >= p.cycle_length_days) {
        headerCells.push(padCell(''));
      } else {
        headerCells.push(padCell(DAYS_OF_WEEK[d]));
      }
    }
    lines.push('  ' + headerCells.join(' │ '));
    lines.push('  ' + divider(headerCells.join(' │ ').length));

    // One row per crew
    for (let c = 0; c < p.crew_count; c++) {
      const rowCells: string[] = [padCell(`${c + 1}`)];
      for (let d = 0; d < 7; d++) {
        const dayIdx = w * 7 + d;
        if (dayIdx >= p.cycle_length_days) {
          rowCells.push(padCell(''));
        } else {
          const designation = p.calendar[c][dayIdx];
          rowCells.push(padCell(DESIGNATION_LABEL[designation] ?? designation));
        }
      }
      lines.push('  ' + rowCells.join(' │ '));
    }
  }

  // Footer: per-crew shift count summary
  lines.push('');
  for (let c = 0; c < p.crew_count; c++) {
    const counts: Record<string, number> = { D: 0, N: 0, A: 0, RDO: 0 };
    for (const desig of p.calendar[c]) counts[desig]++;
    const workShifts = counts.D + counts.N + counts.A;
    const totalHours = workShifts * 12; // best-effort; fixed_day really is 8h
    const weekAvg = (totalHours / (p.cycle_length_days / 7)).toFixed(1);
    lines.push(
      `  Crew ${c + 1} totals over ${p.cycle_length_days}d: ` +
        `D=${counts.D}  N=${counts.N}  A=${counts.A}  RDO=${counts.RDO}  ` +
        `(${workShifts} shifts × 12h = ${totalHours}h ≈ ${weekAvg} h/wk; ` +
        `8h shifts would be ${workShifts * 8}h)`
    );
  }
  return lines.join('\n');
}

function main() {
  console.log('SKT-04A Shift Pattern Preview');
  console.log('=============================');
  console.log('Verify each grid below against the contract page images:');
  console.log('  - 1_crew_weekend, 2_crew_fixed_d_n, 2_crew_fixed_d_afternoon: page 215-216');
  console.log('  - 4_crew_12h_rotating: page 216');
  console.log('  - 4_crew_12h_fixed:    page 217');
  console.log('  - fixed_day / fixed_evening / fixed_night: derived (no dedicated contract grid)');
  console.log('');
  for (const p of ALL_SHIFT_PATTERNS) {
    console.log(renderPattern(p));
    console.log('');
    console.log('═'.repeat(80));
  }
}

main();
