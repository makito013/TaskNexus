// Markdown in a task description may contain "# Title". The screen already owns
// the only h1 (and the detail title is an h2), so the rendered, already
// sanitized HTML has its headings pushed two levels down (h1 -> h3 ... h5/h6 -> h6).
// Only tag names change; escaped text such as "&lt;h1" cannot match.
export function demoteHeadings(html) {
  return html.replace(/<(\/?)h([1-6])(?=[\s>])/gi, (_match, slash, level) => (
    `<${slash}h${Math.min(Number(level) + 2, 6)}`
  ))
}
