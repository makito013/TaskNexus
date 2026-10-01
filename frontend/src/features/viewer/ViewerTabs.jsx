// frontend/src/features/viewer/ViewerTabs.jsx
// Fase V-2 (6.2): uma aba por arquivo aberto, na ordem em que foram abertas.
// Toque troca, × fecha, rolagem horizontal quando não couberem (a rolagem é só
// desta faixa — o painel em si nunca rola na horizontal).
import { useEffect, useRef } from 'react';
import { basenameOf } from './viewerPaths.js';

export function tabLabel(item) {
  const title = item.title || basenameOf(item.path);
  // `main.py:42` como no mockup: a linha faz parte de "qual pedaço o agente
  // quis mostrar".
  return item.line && item.kind === 'code' ? `${title}:${item.line}` : title;
}

export function ViewerTabs({ items, activeId, onSelect, onClose }) {
  const listRef = useRef(null);

  // A aba que acabou de ficar ativa (ex.: o agente abriu a 9ª) entra na área
  // visível da faixa.
  useEffect(() => {
    // A aba inteira (rótulo + ×), não só o rótulo: senão o × da última aba
    // ficava cortado atrás dos botões do cabeçalho.
    const label = listRef.current?.querySelector('[aria-selected="true"]');
    const el = label?.closest('.vw-tab') || label;
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [activeId]);

  return (
    <div className="vw-tabs" role="tablist" aria-label="Arquivos abertos" ref={listRef}>
      {items.map((item) => {
        const active = item.id === activeId;
        const label = tabLabel(item);
        return (
          <div key={item.id} className={`vw-tab${active ? ' vw-tab--active' : ''}`}>
            <button
              type="button"
              role="tab"
              aria-selected={active}
              className="vw-tab-label"
              title={item.path}
              onClick={() => onSelect(item.id)}
            >
              {label}
            </button>
            <button
              type="button"
              className="vw-tab-close"
              aria-label={`Fechar aba ${label}`}
              onClick={() => onClose(item.id)}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
