// frontend/src/utils/markdown.js
// Extracted from TaskDetailModal.jsx (Tarefa 13, 05-TL.md) so the
// markdown-to-safe-HTML conversion can be unit tested in isolation from the
// component. Behavior is unchanged: marked() renders the markdown, then
// DOMPurify sanitizes the resulting HTML before it's used with
// dangerouslySetInnerHTML.
import { marked } from 'marked';
import DOMPurify from 'dompurify';

export function renderMarkdown(md) {
  const raw = marked.parse(md || '');
  return DOMPurify.sanitize(raw);
}
