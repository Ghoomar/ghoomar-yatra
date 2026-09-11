import { createClient } from '@/lib/supabase/client';

export interface AuditLogPayload {
  userId?: string | null;
  action:
    | 'CREATE'
    | 'UPDATE'
    | 'DELETE'
    | 'STATUS_CHANGE'
    | 'DAY_LOCK'
    | 'DAY_REOPEN'
    | 'SALARY_PAYOUT'
    | 'STOCK_ADJUSTMENT'
    | string;
  entityType?: string;
  entity?: string;
  entityId?: string | null;
  oldValues?: any;
  newValues?: any;
  details?: any;
}

export async function logAuditAction({
  userId,
  action,
  entityType,
  entity,
  entityId,
  oldValues,
  newValues,
  details,
}: AuditLogPayload): Promise<void> {
  try {
    const supabase = createClient();
    let currentUserId = userId;

    if (!currentUserId) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      currentUserId = user?.id || null;
    }

    await supabase.from('audit_logs').insert({
      user_id: currentUserId,
      action,
      entity_type: entityType || entity || 'Unknown',
      entity_id: entityId ? String(entityId) : null,
      old_values: oldValues || null,
      new_values: newValues || details || null,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Failed to record audit log:', err);
  }
}
