import { prisma } from '@/lib/db';

export async function logAudit(params: {
  actorUserId?: string | null;
  actionType: string;
  targetType: string;
  targetId?: string | null;
  metadata?: Record<string, any>;
}) {
  const { actorUserId, actionType, targetType, targetId, metadata } = params;
  try {
    await prisma.audit_logs.create({
      data: {
        actor_user_id: actorUserId ?? null,
        action_type: actionType,
        target_type: targetType,
        target_id: targetId ?? null,
        metadata_json: JSON.stringify(metadata ?? {})
      }
    });
  } catch (e) {
    // best-effort; avoid throwing
    console.error('audit log failed', e);
  }
}

