import { useEffect, useMemo, useRef, useState } from 'react'
import { MAX_HIGHLIGHT_CHARS, highlightToTokens, resolveLanguage, tokenStyle } from '../../../../../utils/syntaxHighlight.js'
import Button from '../../../components/Button/Button.jsx'
import { useThemeName } from './useThemeName.js'

// 20 thousand <div>s freeze an iPad; the rest is reachable by "Baixar".
export const MAX_RENDERED_LINES = 20_000
const FLASH_MS = 2000

// Scrolls the nearest scroll container of the panel (never scrollIntoView: that would move the shell too).
export function scrollContainerTo(container, target, { center = false } = {}) {
  const scroller = container.closest('[data-viewer-scroll]')
  if (!scroller || !target) return
  const offset = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
  scroller.scrollTop = center ? offset - scroller.clientHeight / 2 : offset
}

// Code or plain text: one <div> per line (so the number stays out of the selection and one line can be painted),
// plain text at once, Shiki tokens when they arrive (same height: no jump). A highlight that fails or is
// refused leaves the plain text, silently.
export default function CodeView({ text = '', language, line = null, flashKey = null }) {
  const [wrap, setWrap] = useState(false)
  const [tokens, setTokens] = useState(null)
  const [flashing, setFlashing] = useState(false)
  const containerRef = useRef(null)
  const theme = useThemeName()

  const lines = useMemo(() => {
    const all = String(text).replace(/\r\n?/g, '\n').split('\n')
    if (all.length > 1 && all[all.length - 1] === '') all.pop()
    return all
  }, [text])
  const clipped = lines.length > MAX_RENDERED_LINES
  const visibleLines = clipped ? lines.slice(0, MAX_RENDERED_LINES) : lines
  const tooBigToHighlight = String(text).length > MAX_HIGHLIGHT_CHARS

  useEffect(() => {
    let cancelled = false
    setTokens(null)
    if (!resolveLanguage(language) || clipped || tooBigToHighlight) return undefined
    Promise.resolve()
      .then(() => highlightToTokens(visibleLines.join('\n'), language))
      .then((result) => {
        if (!cancelled && result && result.length === visibleLines.length) setTokens(result)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // The theme is a dependency on purpose: the colours follow data-theme.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, language, theme])

  useEffect(() => {
    if (!line || !containerRef.current) return undefined
    const target = containerRef.current.querySelector(`[data-line="${line}"]`)
    if (!target) return undefined
    scrollContainerTo(containerRef.current, target, { center: true })
    setFlashing(true)
    const timer = setTimeout(() => setFlashing(false), FLASH_MS)
    return () => clearTimeout(timer)
  }, [line, flashKey, text])

  return (
    <div ref={containerRef} className="v3-viewer-codeview" data-testid="viewer-code">
      <div className="v3-viewer-code-bar">
        <span className="v3-type-mono-sm">
          {lines.length} {lines.length === 1 ? 'linha' : 'linhas'}
          {language && language !== 'text' ? ` · ${language}` : ''}
        </span>
        <Button variant="text" size="sm" aria-pressed={wrap} onClick={() => setWrap((value) => !value)}>Quebrar linhas</Button>
      </div>
      {tooBigToHighlight && !clipped ? (
        <p className="v3-callout v3-callout--info v3-viewer-callout">Arquivo grande: sem destaque de sintaxe.</p>
      ) : null}
      <div className={`v3-viewer-code${wrap ? ' v3-viewer-code--wrap' : ''}`}>
        {visibleLines.map((content, index) => {
          const number = index + 1
          const target = line === number
          const lineTokens = tokens?.[index]
          return (
            <div
              key={number}
              data-line={number}
              className={`v3-viewer-line${target ? ' v3-viewer-line--target' : ''}${target && flashing ? ' v3-viewer-line--flash' : ''}`}
            >
              <span className="v3-viewer-line__number" aria-hidden="true">{number}</span>
              <span className="v3-viewer-line__text">
                {lineTokens
                  ? lineTokens.map((token, position) => <span key={position} style={tokenStyle(token)}>{token.content}</span>)
                  : content || ' '}
              </span>
            </div>
          )
        })}
      </div>
      {clipped ? (
        <p className="v3-callout v3-callout--info v3-viewer-callout">
          Mostrando as primeiras {MAX_RENDERED_LINES.toLocaleString('pt-BR')} linhas. Baixe o arquivo para ver o resto.
        </p>
      ) : null}
    </div>
  )
}
