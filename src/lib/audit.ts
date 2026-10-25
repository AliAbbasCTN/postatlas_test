import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

type AuditMetadata = { [key: string]: string | number | boolean | null | AuditMetadata | AuditMetadata[] };

// Append-only trail of security-relevant actions (the table rejects UPDATE and
// DELETE). Never pass passwords, tokens or payment references in metadata.
// Audit logging must not break the action that triggered it, so failures are
// logged server-side and swallowed.
export async function logAudit(entry: {
  actorId: string | null;
  organizationId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  metadata?: AuditMetadata;
}) {
  try {
    const { error } = await createAdminClient().from("audit_logs").insert({
      actor_id: entry.actorId,
      organization_id: entry.organizationId ?? null,
      action: entry.action,
      resource_type: entry.resourceType,
      resource_id: entry.resourceId ?? null,
      metadata: entry.metadata ?? null
    });
    if (error) console.error("[audit] insert failed:", error.message);
  } catch (e) {
    console.error("[audit]", e instanceof Error ? e.message : "unknown");
  }
}
