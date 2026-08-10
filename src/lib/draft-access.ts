// Authorization for drafts and their attachments.
//
// A draft is reachable by its owner, or — when it is a shared team draft — by
// anyone with the matching permission on its mailbox. `requireReply` picks
// `can_reply` (mutations) over `can_view` (reads).
import { prisma } from '@/lib/db';
import { copyStoredFile } from '@/lib/attachment-storage';
import type { DeliverAttachment } from '@/lib/mail/deliver';

export async function checkAccess(draftId: string, userId: string, requireReply = false) {
  const draft = await prisma.drafts.findUnique({
    where: { id: draftId },
    include: { updatedBy: { select: { name: true } } },
  });
  if (!draft) return { draft: null, accessible: false };

  if (draft.user_id === userId) return { draft, accessible: true };

  if (!draft.is_shared || !draft.mailbox_id) return { draft, accessible: false };

  const accessible = await prisma.mailboxes.findFirst({
    where: {
      id: draft.mailbox_id,
      OR: [
        { type: 'personal', owner_user_id: userId },
        { permissions: { some: { user_id: userId, [requireReply ? 'can_reply' : 'can_view']: true } } },
      ],
    },
    select: { id: true },
  });
  return { draft, accessible: !!accessible };
}

export class DraftAttachmentAccessError extends Error {}

// Turns draft attachment ids (sent by the composer at send time) into
// DeliverAttachment records. Each file is copied to a fresh storage key so the
// resulting message/scheduled send owns its own copy — the draft is deleted
// right after a successful send, taking its files with it.
export async function resolveDraftAttachments(ids: string[], userId: string): Promise<DeliverAttachment[]> {
  if (ids.length === 0) return [];

  const rows = await prisma.draft_attachments.findMany({ where: { id: { in: ids } } });
  if (rows.length !== new Set(ids).size) {
    throw new DraftAttachmentAccessError('draft attachment not found');
  }

  for (const draftId of new Set(rows.map(r => r.draft_id))) {
    const { accessible } = await checkAccess(draftId, userId, true);
    if (!accessible) throw new DraftAttachmentAccessError('forbidden');
  }

  const resolved: DeliverAttachment[] = [];
  for (const row of rows) {
    resolved.push({
      filename: row.filename,
      content_type: row.content_type,
      size: row.size,
      storage_key: await copyStoredFile(row.storage_key, row.filename),
    });
  }
  return resolved;
}
