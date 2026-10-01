// frontend/src/features/viewer/renderers/CodeView.jsx
// Fase V-2 (6.5.4): código/texto com números de linha, destaque de sintaxe
// (Shiki, progressivo), quebra de linha opcional e rolagem até a `linha` que o
// agente pediu, destacada por 2 s.
//
// Uma <div> por linha (e não um <pre> único) porque é o que permite: número
// fora da seleção (`user-select: none` — selecionar três linhas com o dedo e
// colar no Notas não leva os números), rolar até uma linha específica e pintar
// só ela. O texto continua selecionável nativamente.
import { useEffect, useMemo, useRef, useState } from 'react';
import { highlightToTokens, resolveLanguage, tokenStyle } from '../highlight.js';

// Arquivos enormes: sem destaque (ver MAX_HIGHLIGHT_CHARS) e com um teto de
// linhas renderizadas — 20 mil <div>s travam o Safari do iPad. O resto fica
// acessível pelo Baixar.
const MAX_RENDERED_LINES = 20_000;

const FLASH_MS = 2000;

export function CodeView({ text = '', language, line = null, flashKey = null, showBar = true }) {
  const [wrap, setWrap] = useState(false);
  const [tokens, setTokens] = useState(null);
  const containerRef = useRef(null);

  const lines = useMemo(() => {
    const all = String(text).replace(/\r\n?/g, '\n').split('\n');
    // Último "\n" do arquivo não é uma linha a mais.
    if (all.length > 1 && all[all.length - 1] === '') all.pop();
    return all;
  }, [text]);
  const clipped = lines.length > MAX_RENDERED_LINES;
  const visibleLines = clipped ? lines.slice(0, MAX_RENDERED_LINES) : lines;

  // Destaque progressivo: mostra o texto puro na hora e troca pelos tokens
  // quando o Shiki (carregado sob demanda) terminar. Um texto novo descarta o
  // resultado de um destaque antigo ainda em voo.
  useEffect(() => {
    let cancelled = false;
    setTokens(null);
    if (!resolveLanguage(language) || clipped) return undefined;
    highlightToTokens(visibleLines.join('\n'), language).then((result) => {
      if (!cancelled && result && result.length === visibleLines.length) setTokens(result);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, language]);

  // Rolar até a linha e piscar o destaque. `flashKey` (o updated_at do item)
  // faz o agente reabrir o mesmo arquivo na mesma linha piscar de novo.
  const [flashing, setFlashing] = useState(false);
  useEffect(() => {
    if (!line || !containerRef.current) return undefined;
    const target = containerRef.current.querySelector(`[data-line="${line}"]`);
    if (!target) return undefined;
    if (typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ block: 'center' });
    }
    setFlashing(true);
    const timer = setTimeout(() => setFlashing(false), FLASH_MS);
    return () => clearTimeout(timer);
  }, [line, flashKey, text]);

  return (
    <div ref={containerRef} data-testid="viewer-code">
      {showBar && (
        <div className="vw-code-bar">
          <span>
            {lines.length} {lines.length === 1 ? 'linha' : 'linhas'}
            {language && language !== 'text' ? ` · ${language}` : ''}
          </span>
          <button
            type="button"
            className={`vw-btn vw-btn--quiet${wrap ? ' vw-btn--active' : ''}`}
            aria-pressed={wrap}
            onClick={() => setWrap((w) => !w)}
          >
            Quebrar linhas
          </button>
        </div>
      )}
      {/* A rolagem horizontal (linhas longas sem quebra) é DESTE bloco, não do
          corpo do painel: a barra acima continua parada e o painel em si nunca
          rola para o lado. */}
      <div className={`vw-code${wrap ? ' vw-code--wrap' : ''}`} role="presentation">
        <div className="vw-code-lines">
        {visibleLines.map((content, index) => {
          const number = index + 1;
          const isTarget = line === number;
          const lineTokens = tokens?.[index];
          return (
            <div
              key={number}
              data-line={number}
              className={`vw-line${isTarget ? ' vw-line--target' : ''}${isTarget && flashing ? ' vw-line--flash' : ''}`}
            >
              <span className="vw-line-no" aria-hidden="true">{number}</span>
              <span className="vw-line-text">
                {lineTokens
                  ? lineTokens.map((token, i) => (
                    <span key={i} style={tokenStyle(token)}>{token.content}</span>
                  ))
                  : content || ' '}
              </span>
            </div>
          );
        })}
        </div>
      </div>
      {clipped && (
        <div className="vw-state">
          Mostrando as primeiras {MAX_RENDERED_LINES.toLocaleString('pt-BR')} linhas. Baixe o arquivo para ver o resto.
        </div>
      )}
    </div>
  );
}
