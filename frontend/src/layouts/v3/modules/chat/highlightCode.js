// Syntax highlighting of the fenced code blocks of an agent message. shiki is heavy, so it is loaded
// on demand (the first block that needs it) and never by the V2 bundle. The plain <pre><code> is
// always rendered first; this only upgrades it afterwards, and any failure (the library did not
// load, an unknown language) leaves the plain block untouched.
//
// The tokens are written as DOM text nodes inside <span> elements (textContent, style.color): the
// highlighter output is never parsed as HTML, so a block can never become markup.
const FONT_ITALIC = 1
const FONT_BOLD = 2
const FONT_UNDERLINE = 4

let shikiLoad = null
function loadShiki() {
  if (!shikiLoad) shikiLoad = import('shiki').catch(() => null)
  return shikiLoad
}

function currentTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'github-dark' : 'github-light'
}

function languageOf(code) {
  const match = /(?:^|\s)language-([\w+#-]+)/.exec(code.className || '')
  return match ? match[1] : null
}

function tokenSpan(token) {
  const span = document.createElement('span')
  span.textContent = token.content
  if (token.color) span.style.color = token.color
  if (token.fontStyle & FONT_ITALIC) span.style.fontStyle = 'italic'
  if (token.fontStyle & FONT_BOLD) span.style.fontWeight = '600'
  if (token.fontStyle & FONT_UNDERLINE) span.style.textDecoration = 'underline'
  return span
}

// A block is up to date when it was highlighted with the theme that is on the page now: a theme switch
// leaves highlighted blocks stale, and the next call re-colours them (from their own text, which the
// token spans never change).
const needsHighlight = (code, theme) => languageOf(code) && !(code.dataset.highlighted && code.dataset.highlightTheme === theme)

export async function highlightCodeBlocks(root, isCancelled = () => false) {
  const theme = currentTheme()
  const blocks = [...root.querySelectorAll('pre > code')].filter((code) => needsHighlight(code, theme))
  if (blocks.length === 0) return
  const shiki = await loadShiki()
  if (!shiki || isCancelled()) return
  for (const code of blocks) {
    try {
      const { tokens } = await shiki.codeToTokens(code.textContent, { lang: languageOf(code), theme })
      if (isCancelled() || !code.isConnected) return
      // The theme changed while the tokens were computed: a newer call paints this block.
      if (theme !== currentTheme()) return
      const fragment = document.createDocumentFragment()
      tokens.forEach((line, index) => {
        for (const token of line) fragment.append(tokenSpan(token))
        if (index < tokens.length - 1) fragment.append('\n')
      })
      code.replaceChildren(fragment)
      code.dataset.highlighted = 'true'
      code.dataset.highlightTheme = theme
    } catch {
      // unknown language or a failed grammar load: the plain block stays
    }
  }
}
