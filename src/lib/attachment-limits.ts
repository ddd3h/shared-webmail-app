// Shared between the composer UI and the draft upload route so the client-side
// guard and the server-side check can never drift apart. No Node imports here —
// this module is pulled into the client bundle.
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB per file
export const MAX_ATTACHMENTS = 10;
