// frontend/src/utils/clipboard.js
// Copy plain text to the clipboard, with a fallback for insecure origins.
//
// Why the fallback exists: `navigator.clipboard` is gated behind a secure
// context. The app is routinely reached over Tailscale on plain HTTP with a
// non-localhost host, where the whole `navigator.clipboard` object is
// `undefined` — and, on some browsers, present but rejecting. Both shapes
// fall through to the legacy `document.execCommand('copy')` path.
//
// Returns `true` when a copy path reported success, `false` otherwise. It
// never throws: the caller renders a small failure glyph instead of an
// unhandled rejection.

function copyViaExecCommand(text) {
  // A temporary off-screen textarea is the only portable way to feed
  // execCommand: it needs a real, selectable, focusable node in the document.
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '0';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  try {
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    return document.execCommand('copy') === true;
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}

export async function copyTextToClipboard(text) {
  const value = String(text ?? '');
  if (!value) return false;

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Secure-context API present but refused (permission denied, insecure
      // origin, document not focused) — keep going, do not swallow silently.
    }
  }

  return copyViaExecCommand(value);
}
