// frontend/src/layouts/v2/ClienteList.jsx
// Navegação mobile dedicada do Layout v2 (plano do TL, Tarefa 7): extraído de
// SidebarV2.jsx (bloco "Todos" + `clientes.map`), sem mudança de
// comportamento no variant default ('sidebar').
//
// Regra não negociável: retorna um Fragment (divider + label + lista), NÃO
// um <div> — precisa continuar filho direto do `scrollArea` de quem o usa
// (SidebarV2.jsx hoje) para o teste de rolagem conjunta continuar válido
// (nav.parentElement === clientesLabel.parentElement em SidebarV2.test.jsx).
//
// `variant` (mesmo padrão de NavTabs.jsx, não fazia parte da extração 1:1 do
// plano original, mas é necessário pra Tarefa 11/MobileMenuScreen — "linhas
// 52-56px de altura, mais respiro que os 44px do desktop"): muda só valores
// de `style` (altura de linha), a estrutura de DOM é idêntica.
//   - 'sidebar' (default): visual atual, linhas de 44px (--touch-target).
//   - 'mobile': linhas mais altas (54px), usado só por MobileMenuScreen.jsx.
//
// `collapsed` (retrabalho pontual, pedido literal do Bruno: "deveria ao
// esconder ficar os icones avatar" + confirmação "do cliente, deveria ficar o
// avatar do cliente tb"): default `false` — SÓ SidebarV2.jsx (desktop) passa
// esta prop; MobileMenuScreen.jsx usa este componente sem passá-la, então seu
// visual não muda em nada. Quando `true`: divider + rótulo "Clientes" somem,
// e cada item (inclusive "Todos") passa a renderizar um avatar circular
// (.v2-cliente-avatar) em vez do nome por extenso — mesmo onClick/title de
// antes, só o conteúdo interno do item muda. "Todos" usa o glyph "✱" (não
// iniciais "T" — colidiria visualmente com um cliente real cujo nome comece
// com T; achado do QA: "▦" também colidiria com o ícone de nav do Board,
// que já usa esse mesmo glyph em AppV2.jsx).
//
// Fase N (docs/melhorias-tablet/08-planejamento-navegacao-cliente-projeto.md,
// seção 8.2.1): a MESMA área vira um drill-down Clientes → Projetos →
// subprojetos, para o projeto ganhar lugar na navegação sem abrir uma coluna
// nova (a ideia é liberar espaço à direita, não gastar mais).
//   - Nível Clientes: "Todos" + clientes. Quem tem subprojetos mostra "›" e,
//     ao toque, ENTRA no nível Projetos (e fica selecionado inteiro). Cliente
//     SEM subprojetos só é selecionado, como antes (decisão do Bruno).
//   - Nível Projetos: botão "← Clientes" (44px, largura toda), rótulo
//     "CLIENTE · PROJETOS", "Todos os projetos", "Raiz" (só se a pasta do
//     cliente for elegível para chat) e os filhos diretos. Filho com filhos
//     mostra "›" e desce mais um nível; aí o botão de voltar passa a nomear o
//     nível para onde ele leva (o pai), no mesmo padrão de "← Clientes".
//   - Recolhida (68px): "←" no topo e avatares (✱ = Todos os projetos,
//     ⌂ = Raiz, inicial = projeto), com o nome no `title`.
//   - Mobile: mesmo comportamento, linhas de 54px (o botão de voltar também,
//     para o alvo de toque não encolher justamente no celular).
// Este componente não guarda estado de navegação: quem manda é o escopo
// global (hooks/useNavScope.js, via AppV2). Sem `projects` (uso antigo, só com
// `clientes`), nenhum cliente tem filhos e tudo se comporta como antes.
//
// Cada linha tem `role="button"` + Enter/Espaço: antes eram <div>s só com
// onClick, inalcançáveis pelo teclado do iPad — com um nível a mais para
// descer, isso deixaria projetos inteiros fora do alcance de quem navega por
// teclado.

import { Fragment, useEffect, useRef, useState } from 'react';
import { childrenOf, hasChildren, labelFor, parentOf } from '../../utils/projectTree.js';

const baseStyles = {
  divider: {
    height: '1px',
    background: 'var(--v2-border)',
    margin: '8px 12px',
    flexShrink: 0,
  },
  sectionLabel: {
    fontSize: '10px',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: 'var(--v2-text-faint)',
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
    padding: '4px 12px 6px',
    flexShrink: 0,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  projectList: {
    padding: '0 8px',
  },
  // Nome dentro da linha: um <span> próprio (e não texto solto na linha flex)
  // para a reticência funcionar — `text-overflow` não se aplica a um
  // container flex, só a um bloco — e para o "›" nunca ser empurrado para
  // fora por um nome longo.
  label: {
    flex: 1,
    minWidth: 0,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  chevron: {
    flexShrink: 0,
    marginLeft: '8px',
    color: 'var(--v2-text-dim)',
    fontSize: '15px',
    lineHeight: 1,
  },
};

function projectItemStyle(active, minHeight, collapsed) {
  return {
    padding: collapsed ? '4px 0' : '8px 10px',
    borderRadius: '8px',
    cursor: 'pointer',
    marginBottom: '2px',
    minHeight,
    display: 'flex',
    alignItems: 'center',
    justifyContent: collapsed ? 'center' : 'flex-start',
    background: active ? 'var(--v2-surface-2)' : 'transparent',
    color: active ? 'var(--v2-text)' : 'var(--v2-text-dim)',
    fontSize: '13px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  };
}

// "← Clientes" do mockup (img/13): contorno fino, largura toda, texto forte.
// Recolhido vira um alvo quadrado do mesmo tamanho dos avatares da coluna.
function backButtonStyle(minHeight, collapsed) {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: collapsed ? 'center' : 'flex-start',
    gap: '6px',
    width: '100%',
    minHeight,
    padding: collapsed ? '4px 0' : '0 10px',
    marginBottom: '6px',
    borderRadius: '8px',
    border: '1px solid var(--v2-border)',
    background: 'transparent',
    color: 'var(--v2-text)',
    fontFamily: 'inherit',
    fontSize: '13px',
    fontWeight: 700,
    textAlign: 'left',
    cursor: 'pointer',
    boxSizing: 'border-box',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  };
}

// Mesmo padrão de `initialsFor` em ChatList.jsx — duplicado de propósito (2
// linhas, não vale um módulo compartilhado só por isso, decisão já tomada
// pelo Bruno pra esta rodada).
function initialsFor(name) {
  return (name || '?').trim().slice(0, 1).toUpperCase();
}

// Profundidade do que está sendo listado: 0 = Clientes, 1 = projetos de um
// cliente, 2 = filhos de um projeto… Decide a direção da animação de troca.
function depthOf(level, parentId) {
  if (level !== 'projetos' || !parentId) return 0;
  return parentId.split('/').length;
}

export function ClienteList({
  clientes = [],
  projects = [],
  selectedClienteId,
  selectedProjetoId = null,
  level = 'clientes',
  parentId = null,
  onSelectCliente,
  onEnterCliente,
  onSelectProjeto,
  onEnterProjeto,
  onBack,
  variant = 'sidebar',
  collapsed = false,
}) {
  const minHeight = variant === 'mobile' ? '54px' : 'var(--touch-target, 44px)';
  const inProjetos = level === 'projetos' && !!parentId && selectedClienteId != null;
  const depth = inProjetos ? depthOf(level, parentId) : 0;
  const navKey = inProjetos ? `projetos:${parentId}` : 'clientes';

  // Animação curta de deslizar ao trocar de nível (8.2.1, item 2): a lista é
  // remontada pela `key` e ganha a classe da direção certa. Nada no primeiro
  // render — a página abrindo não é uma navegação. A classe fica guardada POR
  // `navKey` (ajuste de estado durante o render, padrão do React para estado
  // derivado de prop): um re-render qualquer no meio dos 160ms (um poll de
  // sessões, por exemplo) não pode tirar a classe e cortar a animação.
  const [anim, setAnim] = useState({ key: navKey, depth, className: undefined });
  let enterClass = anim.className;
  if (anim.key !== navKey) {
    enterClass = depth === anim.depth
      ? undefined
      : depth > anim.depth
      ? 'v2-nav-level-enter-forward'
      : 'v2-nav-level-enter-back';
    setAnim({ key: navKey, depth, className: enterClass });
  }

  // Foco depois da troca de nível: a lista é remontada, então o nó que tinha
  // o foco some e ele cairia no <body>. Só quando a navegação veio do TECLADO
  // (Enter/Espaço) — um toque não deve fazer um anel de foco aparecer.
  const backButtonRef = useRef(null);
  const listRef = useRef(null);
  const focusAfterNavRef = useRef(null);
  useEffect(() => {
    const target = focusAfterNavRef.current;
    focusAfterNavRef.current = null;
    if (target === 'back') {
      backButtonRef.current?.focus();
    } else if (typeof target === 'string') {
      const rows = listRef.current?.querySelectorAll('[data-nav-id]') || [];
      const row = Array.from(rows).find((el) => el.getAttribute('data-nav-id') === target) || rows[0];
      row?.focus();
    }
  }, [navKey]);

  // Linha clicável: onClick + Enter/Espaço. `focusTarget` diz para onde o
  // foco vai se a ação trocar o nível (ver efeito acima).
  const rowProps = (onActivate, focusTarget) => ({
    role: 'button',
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      focusAfterNavRef.current = focusTarget ?? null;
      onActivate();
    },
  });

  const renderRow = ({ id, navId, title, text, avatar, active, chevron, ariaLabel, onActivate, focusTarget }) => (
    <div
      key={id}
      data-nav-id={navId}
      style={projectItemStyle(active, minHeight, collapsed)}
      title={title}
      aria-current={active ? 'true' : undefined}
      aria-label={ariaLabel}
      {...rowProps(onActivate, focusTarget)}
    >
      {collapsed ? (
        <span className="v2-cliente-avatar">{avatar}</span>
      ) : (
        <>
          <span style={baseStyles.label}>{text}</span>
          {chevron && <span style={baseStyles.chevron} aria-hidden="true">›</span>}
        </>
      )}
    </div>
  );

  if (!inProjetos) {
    return (
      <Fragment>
        {!collapsed && <div style={baseStyles.divider} />}
        {!collapsed && <div style={baseStyles.sectionLabel}>Clientes</div>}
        <div key={navKey} ref={listRef} style={baseStyles.projectList} className={enterClass}>
          {renderRow({
            id: '__todos__',
            navId: '__todos__',
            title: 'Todos',
            text: 'Todos',
            avatar: '✱',
            active: selectedClienteId == null,
            onActivate: () => onSelectCliente(null),
          })}
          {clientes.map((p) => {
            const drills = !!onEnterCliente && hasChildren(p.id, projects);
            return renderRow({
              id: p.id,
              navId: p.id,
              title: p.nome,
              text: p.nome,
              avatar: initialsFor(p.nome),
              active: p.id === selectedClienteId,
              chevron: drills,
              ariaLabel: drills ? `${p.nome}, ver projetos` : undefined,
              onActivate: drills ? () => onEnterCliente(p.id) : () => onSelectCliente(p.id),
              focusTarget: drills ? 'back' : null,
            });
          })}
        </div>
      </Fragment>
    );
  }

  // --- Nível Projetos -------------------------------------------------------
  const clienteId = selectedClienteId;
  const atClienteLevel = parentId === clienteId;
  const upId = parentOf(parentId);
  const backLabel = atClienteLevel ? 'Clientes' : labelFor(upId, projects);
  const clienteElegivel = projects.find((p) => p.id === clienteId)?.elegivel === true;

  // "Todos os projetos" do nível = a subárvore inteira do nó listado. No
  // nível do cliente isso é `projetoId: null` (o cliente inteiro); abaixo
  // dele, o próprio nó (ver hooks/useNavScope.js).
  const todosValue = atClienteLevel ? null : parentId;
  const todosActive = atClienteLevel ? selectedProjetoId == null : selectedProjetoId === parentId;
  const isInside = (id) =>
    selectedProjetoId != null && (selectedProjetoId === id || selectedProjetoId.startsWith(`${id}/`));

  const handleBack = () => onBack?.();

  return (
    <Fragment>
      {!collapsed && <div style={baseStyles.divider} />}
      <div key={navKey} ref={listRef} style={baseStyles.projectList} className={enterClass}>
        <button
          ref={backButtonRef}
          type="button"
          style={backButtonStyle(minHeight, collapsed)}
          onClick={handleBack}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') focusAfterNavRef.current = parentId;
          }}
          title={`Voltar para ${backLabel}`}
          aria-label={`Voltar para ${backLabel}`}
        >
          <span aria-hidden="true">←</span>
          {!collapsed && <span style={baseStyles.label}>{backLabel}</span>}
        </button>
        {!collapsed && (
          <div style={{ ...baseStyles.sectionLabel, padding: '4px 4px 6px' }}>
            {labelFor(parentId, projects)} · Projetos
          </div>
        )}
        {renderRow({
          id: '__todos-projetos__',
          navId: '__todos-projetos__',
          title: 'Todos os projetos',
          text: 'Todos os projetos',
          avatar: '✱',
          active: todosActive,
          onActivate: () => onSelectProjeto?.(todosValue),
        })}
        {atClienteLevel && clienteElegivel && renderRow({
          id: '__raiz__',
          navId: '__raiz__',
          title: 'Raiz',
          text: 'Raiz',
          avatar: '⌂',
          active: selectedProjetoId === clienteId,
          onActivate: () => onSelectProjeto?.(clienteId),
        })}
        {childrenOf(parentId, projects).map((p) => {
          const drills = !!onEnterProjeto && hasChildren(p.id, projects);
          return renderRow({
            id: p.id,
            navId: p.id,
            title: p.nome,
            text: p.nome,
            avatar: initialsFor(p.nome),
            active: isInside(p.id),
            chevron: drills,
            ariaLabel: drills ? `${p.nome}, ver subprojetos` : undefined,
            onActivate: drills ? () => onEnterProjeto(p.id) : () => onSelectProjeto?.(p.id),
            focusTarget: drills ? 'back' : null,
          });
        })}
      </div>
    </Fragment>
  );
}
