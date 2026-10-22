import { schema, type DbOrTx } from "@/db/client";

const FORBIDDEN_KEY = /(password|secret|token|pepper|hash|otp|cvv|card|pin)/i;

export interface AuditEntry {
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  data?: Record<string, unknown>;
}

/**
 * Écrit dans le journal d'audit (append-only). Refuse toute clé évoquant un secret : on n'y journalise
 * jamais de mot de passe, jeton, code de remise ni donnée de paiement.
 */
export async function audit(db: DbOrTx, entry: AuditEntry): Promise<void> {
  const data = entry.data ?? {};
  for (const key of Object.keys(data)) {
    if (FORBIDDEN_KEY.test(key)) throw new Error(`Clé d'audit interdite : ${key}`);
  }
  await db.insert(schema.auditLogs).values({
    actorUserId: entry.actorUserId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    data,
  });
}
