// Audit log helper. Every state-changing action in the system goes through
// here. Entries are hash-chained so any tampering with the log can be detected
// (Plan §6.8 / §16.3 audit immutability).
//
// The chain: each entry's prev_hash is the previous entry's entry_hash.
// entry_hash = sha256(canonical_json({ts, actor_user, action, data, prev_hash})).
// We don't enforce immutability at the database level in slice 1 (a future
// production version can use SQLite triggers, write-once table partitions, or
// separate immutable audit storage); the chain still exposes any modification.

import { createHash } from 'node:crypto';
import { db } from './db.js';

export interface AuditEntry {
  actor_user: string;
  actor_role: string;
  action: string;
  area_id?: string | null;
  posting_id?: string | null;
  offer_id?: string | null;
  employee_id?: string | null;
  data?: Record<string, unknown>;
  reason?: string | null;
}

function canonicalJson(obj: unknown): string {
  // Stable key ordering for hash determinism.
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonicalJson).join(',') + ']';
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  return (
    '{' +
    keys
      .map((k) => JSON.stringify(k) + ':' + canonicalJson((obj as Record<string, unknown>)[k]))
      .join(',') +
    '}'
  );
}

function sha256(s: string): string {
  return 'sha256:' + createHash('sha256').update(s).digest('hex');
}

export function writeAudit(entry: AuditEntry): { id: number; entry_hash: string } {
  const conn = db();
  const ts = new Date().toISOString();

  const prevRow = conn
    .prepare<[], { entry_hash: string }>(
      'SELECT entry_hash FROM audit_log ORDER BY id DESC LIMIT 1'
    )
    .get();
  const prev_hash = prevRow?.entry_hash ?? 'sha256:genesis';

  const data_json = entry.data ? JSON.stringify(entry.data) : null;

  const hashInput = canonicalJson({
    ts,
    actor_user: entry.actor_user,
    action: entry.action,
    area_id: entry.area_id ?? null,
    posting_id: entry.posting_id ?? null,
    offer_id: entry.offer_id ?? null,
    employee_id: entry.employee_id ?? null,
    data: entry.data ?? null,
    prev_hash
  });
  const entry_hash = sha256(hashInput);

  const result = conn
    .prepare(
      `INSERT INTO audit_log
         (ts, actor_user, actor_role, action, area_id, posting_id,
          offer_id, employee_id, data_json, reason, prev_hash, entry_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      ts,
      entry.actor_user,
      entry.actor_role,
      entry.action,
      entry.area_id ?? null,
      entry.posting_id ?? null,
      entry.offer_id ?? null,
      entry.employee_id ?? null,
      data_json,
      entry.reason ?? null,
      prev_hash,
      entry_hash
    );

  return { id: Number(result.lastInsertRowid), entry_hash };
}

export interface AuditRow {
  id: number;
  ts: string;
  actor_user: string;
  actor_role: string;
  action: string;
  area_id: string | null;
  posting_id: string | null;
  offer_id: string | null;
  employee_id: string | null;
  data_json: string | null;
  reason: string | null;
  prev_hash: string | null;
  entry_hash: string | null;
}

export function listAudit(opts: {
  area_id?: string;
  employee_id?: string;
  limit?: number;
} = {}): AuditRow[] {
  const conn = db();
  const limit = opts.limit ?? 200;
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts.area_id) {
    where.push('area_id = ?');
    params.push(opts.area_id);
  }
  if (opts.employee_id) {
    where.push('employee_id = ?');
    params.push(opts.employee_id);
  }
  const sql =
    'SELECT * FROM audit_log' +
    (where.length ? ' WHERE ' + where.join(' AND ') : '') +
    ' ORDER BY id DESC LIMIT ?';
  params.push(limit);
  return conn.prepare(sql).all(...params) as AuditRow[];
}
