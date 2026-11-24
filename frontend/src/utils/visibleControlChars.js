// Makes the characters that change how a text READS (and the invisible ones) visible, for the places
// where a person decides from what they see (stage 10, Y1: "Trojan Source"). A command with U+202E in it
// can show one thing and run another; zero-width and tag characters hide text altogether.
//
//   markInvisibleChars('ls ‮gpj.txt') -> 'ls ⟦U+202E⟧gpj.txt'
//   hasInvisibleChars(text)                -> true when there is anything to mark
//
// Marked: C0/C1 controls except tab, line feed and carriage return; soft hyphen; the Arabic letter mark;
// the Mongolian vowel separator; zero-width and directional marks (U+200B-200F); line/paragraph
// separators and the embedding/override controls (U+2028-202E); word joiner and invisible operators
// (U+2060-2064); isolates (U+2066-2069); the byte order mark; the "tag" block (U+E0000-E007F).
// Pure: never touches the DOM; the result is plain text for React to render as text.

// eslint-disable-next-line no-control-regex
const INVISIBLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u2069\ufeff\u{e0000}-\u{e007f}]/gu

export function hasInvisibleChars(text) {
  return typeof text === 'string' && text.search(INVISIBLE) !== -1
}

export function markInvisibleChars(text) {
  if (typeof text !== 'string') return text
  return text.replace(INVISIBLE, (char) => `⟦U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}⟧`)
}

export const INVISIBLE_CHARS_NOTICE =
  'Este pedido tem caracteres invisíveis ou que mudam a ordem de leitura. Eles aparecem marcados como ⟦U+…⟧: leia com atenção antes de permitir.'
