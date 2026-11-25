import type { Db, DbClient } from '../../db/pool.js';

export interface AuditEntry {
  readonly organizationId: string | null;
  readonly actorUserId: string | null;
  readonly action: string;
  readonly targetType?: string;
  readonly targetId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly ip?: string;
  readonly requestId?: string;
}

/** Append-only write path for the audit trail (UPDATE/DELETE are blocked by a trigger). */
export async function writeAudit(db: Db | DbClient, entry: AuditEntry): Promise<void> {
  await db.query(
    `INSERT INTO audit_events (organization_id, actor_user_id, action, target_type, target_id, metadata, ip, request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      entry.organizationId,
      entry.actorUserId,
      entry.action,
      entry.targetType ?? null,
      entry.targetId ?? null,
      JSON.stringify(entry.metadata ?? {}),
      entry.ip ?? null,
      entry.requestId ?? null,
    ],
  );
}
