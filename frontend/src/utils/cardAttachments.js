// Limits and kinds of the files attached to a card; shared by the V2 card modal and the V3 board.

export const MAX_ATTACHMENTS = 10;

// Types the viewer renders (the backend decides the final `kind`; anything
// else still opens, but only as a "no preview, download" card — so for those
// the row offers just "Baixar").
const PREVIEWABLE_RE = /\.(md|markdown|pdf|html?|txt|log|csv|json|xml|ya?ml|png|jpe?g|gif|webp|svg|avif|bmp)$/i;

export function isPreviewable(filename) {
  return PREVIEWABLE_RE.test(String(filename || ''));
}
