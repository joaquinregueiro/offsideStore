import { getDatabase, schema, type Database } from '@offside/database';

/**
 * Acceso a `audit_log` (ERD §19.1). Sin reglas de negocio.
 *
 * ⚠️ APPEND-ONLY: este repository expone SOLO inserciones. No hay update ni
 * delete a proposito — un registro de auditoria que se puede modificar no sirve
 * como registro de auditoria.
 */

export type AuditLogRow = typeof schema.auditLog.$inferSelect;
export type AuditActorType = (typeof schema.auditLog.actorType.enumValues)[number];

const conn = (db?: Database): Database => db ?? getDatabase();

export interface AppendAuditEntry {
  actorType: AuditActorType;
  /** NULL cuando el actor es el sistema (un job, un webhook). */
  actorId?: string | undefined;
  action: string;
  entityType: string;
  entityId?: string | undefined;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown> | undefined;
}

export async function appendEntry(entry: AppendAuditEntry, db?: Database): Promise<AuditLogRow> {
  const [row] = await conn(db)
    .insert(schema.auditLog)
    .values({
      actorType: entry.actorType,
      actorId: entry.actorId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      before: entry.before ?? null,
      after: entry.after ?? null,
      metadata: entry.metadata ?? null,
    })
    .returning();

  return row!;
}
