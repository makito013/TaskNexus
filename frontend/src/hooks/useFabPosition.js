// frontend/src/hooks/useFabPosition.js
//
// Posição persistida do FAB de atalhos do terminal
// (layouts/v2/TerminalShortcutsFab.jsx): guarda onde o usuário deixou o botão,
// re-deriva px a partir disso a cada mudança de viewport (rotação do tablet,
// teclado abrindo/fechando) e devolve o commit que clampa+gruda+persiste.
//
// Segue o padrão de hooks/useSidebarCollapsed.js: preferência de UI em
// localStorage, leitura lazy no inicializador do useState, todo acesso ao
// storage dentro de try/catch (Safari em modo privado LANÇA no acesso, não só
// na escrita). O que este hook tem a mais são os listeners de viewport.
//
// INVARIANTE CRÍTICA: a fonte de verdade é a PORCENTAGEM (percentRef), nunca o
// px. Toda mudança de viewport re-deriva o px a partir da % persistida.
// Re-clampar o px ATUAL a cada rotação faria a posição catracar pra dentro
// monotonicamente — bug real e observado: 3 rotações e o FAB migrou ~40px do
// canto. Se um refactor futuro trocar `percentToPx(percentRef.current, ...)`
// por `clampPosition(position, ...)`, o catracamento volta.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FAB_SIZE_PX,
  clampPosition,
  getDefaultPosition,
  getPositionBounds,
  getVisibleViewport,
  percentToPx,
  pxToPercent,
  readSafeAreaInsets,
  snapPosition,
} from '../utils/fabGeometry.js';

// Prefixo `escritorio::` é o namespace já em uso por
// `escritorio::sidebar_collapsed` (useSidebarCollapsed.js:18) e
// `escritorio::chat_sidebar_collapsed` (AppV2.jsx). O produto virou TaskNexus,
// mas trocar o prefixo tornaria órfãs as preferências vivas no localStorage do
// iPad do Bruno — mesma lógica do `id: 'escritorio'` deliberado em
// config/systems.js.
export const FAB_POSITION_STORAGE_KEY = 'escritorio::terminal_shortcuts_fab_position';

// O significado de `xPercent` NÃO é auto-descritivo: é fração do range
// posicionável, não da viewport (ver utils/fabGeometry.js pxToPercent). Sem esta
// versão, uma rodada futura que mude a definição posicionaria o FAB errado em
// silêncio a partir de um blob antigo, em vez de cair no canto padrão.
export const FAB_POSITION_SCHEMA_VERSION = 1;

/**
 * readStoredPercent — devolve `{ xPercent, yPercent }` válido ou `null`.
 *
 * Rejeita tudo que não seja exatamente o shape esperado (cobre "posição salva
 * corrompida"): não-JSON, não-objeto, versão de schema diferente, valores
 * não-finitos (inclui NaN, null, strings) e fora de [0, 1]. Qualquer falha ->
 * null -> o chamador cai no canto padrão.
 */
function readStoredPercent() {
  let raw;
  try {
    raw = localStorage.getItem(FAB_POSITION_STORAGE_KEY);
  } catch {
    return null; // Safari em modo privado pode lançar já na LEITURA
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.v !== FAB_POSITION_SCHEMA_VERSION) return null;
    const { xPercent, yPercent } = parsed;
    if (!Number.isFinite(xPercent) || xPercent < 0 || xPercent > 1) return null;
    if (!Number.isFinite(yPercent) || yPercent < 0 || yPercent > 1) return null;
    return { xPercent, yPercent };
  } catch {
    return null; // JSON inválido
  }
}

function writeStoredPercent({ xPercent, yPercent }) {
  try {
    localStorage.setItem(
      FAB_POSITION_STORAGE_KEY,
      JSON.stringify({ v: FAB_POSITION_SCHEMA_VERSION, xPercent, yPercent }),
    );
  } catch { /* ignore — persistir a posição nunca deve quebrar a UI */ }
}

// Lê viewport + insets + bounds de uma vez. Não é memoizável: o ponto é
// justamente reamostrar o mundo real no momento da chamada.
function measure(size) {
  const viewport = getVisibleViewport();
  const insets = readSafeAreaInsets();
  const bounds = getPositionBounds({ viewport, insets, width: size, height: size });
  return { viewport, insets, bounds };
}

export function useFabPosition({ size = FAB_SIZE_PX } = {}) {
  // Uma leitura só, no primeiro render, guardada em ref: é a fonte de verdade
  // da posição. `null` significa "usuário nunca arrastou" -> canto padrão.
  const percentRef = useRef(undefined);
  if (percentRef.current === undefined) percentRef.current = readStoredPercent();

  const [state, setState] = useState(() => {
    const { viewport, insets, bounds } = measure(size);
    const position = percentRef.current
      ? clampPosition(percentToPx(percentRef.current, bounds), bounds)
      : getDefaultPosition(bounds);
    return { position, viewport, insets };
  });

  // `size` muda de valor entre renders em teoria (é prop), então o efeito de
  // viewport precisa dele; guardá-lo em ref evita re-inscrever os listeners a
  // cada render sem mentir sobre a dependência.
  const sizeRef = useRef(size);
  sizeRef.current = size;

  // Suspensão do resync enquanto um gesto de arrasto está em andamento. NÃO é
  // otimização de render: a base do arrasto (startLeft/startTop) é capturada uma
  // única vez no pointerdown, e o resync abaixo re-deriva left/top a partir da %
  // a CADA evento da visual viewport. Se um desses eventos chegar no meio do
  // gesto, o FAB troca de base embaixo do dedo e o drop aterra num lugar que não
  // é onde o dedo estava — isso é perda de posição, não flicker de um frame.
  // O gatilho é raro hoje (exige um evento de visualViewport durante o arrasto),
  // e fica MAIS frequente quando o casco do app passar a encolher com o teclado:
  // o Safari despaneia a visual viewport e emite um `scroll` extra.
  // Quem seta e limpa este ref é layouts/v2/TerminalShortcutsFab.jsx, nos
  // handlers de pointerdown/pointerup/pointercancel — e a limpeza acontece
  // DEPOIS do commit, pra que o setState de commitPosition seja a última escrita
  // de posição do gesto.
  const suspendResyncRef = useRef(false);

  useEffect(() => {
    // Re-derivar SEMPRE da % (ver a invariante no topo do arquivo). Quando não
    // há % salva, o canto padrão é recalculado pra nova viewport — que é o
    // comportamento certo: o default é "canto inferior direito", não um px.
    const resync = () => {
      if (suspendResyncRef.current) return; // gesto em andamento — ver o ref acima
      const { viewport, insets, bounds } = measure(sizeRef.current);
      const position = percentRef.current
        ? clampPosition(percentToPx(percentRef.current, bounds), bounds)
        : getDefaultPosition(bounds);
      setState({ position, viewport, insets });
    };

    const vv = window.visualViewport;
    if (vv) {
      // `scroll` além de `resize` porque o iOS às vezes reporta o encolhimento
      // do teclado como a visual viewport sendo PANEADA, não redimensionada —
      // mesma razão documentada em components/TerminalPanel.jsx:551-553.
      vv.addEventListener('resize', resync);
      vv.addEventListener('scroll', resync);
    }
    // Fallback pra navegadores/ambientes sem visualViewport e pra rotação em
    // navegadores que não emitem resize da visual viewport.
    window.addEventListener('resize', resync);
    window.addEventListener('orientationchange', resync);

    return () => {
      if (vv) {
        vv.removeEventListener('resize', resync);
        vv.removeEventListener('scroll', resync);
      }
      window.removeEventListener('resize', resync);
      window.removeEventListener('orientationchange', resync);
    };
  }, []);

  /**
   * commitPosition — fim de um arrasto: clampa, gruda no canto se estiver perto,
   * persiste a % e atualiza o estado. Devolve a posição FINAL em px, porque o
   * chamador precisa dela no MESMO handler síncrono pra escrever left/top no DOM
   * (ver "commit sem piscada" em TerminalShortcutsFab.jsx) — esperar o próximo
   * render do React ali produz um frame no canto antigo.
   */
  const commitPosition = useCallback((rawPosition) => {
    const { viewport, insets, bounds } = measure(sizeRef.current);
    const snapped = snapPosition(clampPosition(rawPosition, bounds), bounds);
    percentRef.current = pxToPercent(snapped, bounds);

    // NÃO PERSISTIR COM RANGE DEGENERADO. `pxToPercent` delega a `pct1`
    // (utils/fabGeometry.js), que devolve `1` quando `span <= 0` — valor
    // ARBITRÁRIO, escolhido para ser um número em vez de `NaN`. Enquanto os
    // bounds continuam degenerados isso é inofensivo, porque `percentToPx`
    // colapsa qualquer % em `lo`. O problema é o localStorage: o `1` gravado
    // sobrevive ao reload e é relido com bounds SAUDÁVEIS, então um FAB que o
    // usuário deixou no canto SUPERIOR ESQUERDO reaparece no INFERIOR DIREITO.
    // Este `if` é o ponto exato onde esse caminho se fecha, e é por isso que a
    // correção é aqui e não no `pct1`: trocar o `1` por `0` lá só mudaria para
    // qual canto o FAB salta (e derrubaria dois testes de fabGeometry.test.js
    // que documentam o valor de propósito).
    //
    // O guard é de EIXO CRUZADO (`&&`), e isso é decisão, não descuido:
    // degenerescência em UM eixo descarta a persistência dos DOIS, inclusive a
    // do eixo saudável. A % é um PAR sob um único `v: 1` no blob, então gravar
    // metade confiável e metade arbitrária produz um blob que `readStoredPercent`
    // aceita como válido — pior que blob nenhum, porque nenhum fallback dispara.
    // Não "melhorar" isto para um guard por eixo sem trocar o schema junto.
    //
    // LIMITE EXPLÍCITO E CONSCIENTE desta correção mínima: só o
    // `writeStoredPercent` está guardado. A linha acima continua escrevendo o
    // `(1, 1)` degenerado em `percentRef.current`, que alimenta todo `resync`
    // da sessão em curso — ou seja, numa recuperação de viewport SEM remount o
    // FAB ainda teleporta uma vez. Ficou aberto de propósito (decisão do Bruno):
    // a precondição é `vv.width` ou `vv.height` < 68px, inalcançável em
    // dispositivo real (pior caso touch ~175px; iPad com teclado >= 455px), e
    // guardar o ref exigiria decidir o que o hook faz quando NÃO tem % nenhuma
    // para re-derivar — desenho novo, não correção de dívida.
    if (bounds.maxLeft > bounds.minLeft && bounds.maxTop > bounds.minTop) {
      writeStoredPercent(percentRef.current);
    }

    setState({ position: snapped, viewport, insets });
    return snapped;
  }, []);

  return {
    position: state.position,
    viewport: state.viewport,
    insets: state.insets,
    commitPosition,
    suspendResyncRef,
  };
}
