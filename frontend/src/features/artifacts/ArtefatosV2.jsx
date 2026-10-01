// frontend/src/features/artifacts/ArtefatosV2.jsx
// Fase A (docs/melhorias-tablet/07-planejamento-artefatos.md, 7.2 e 7.5): a tela
// Artefatos — a "galeria" de entregáveis (.md, .html, .pdf) por cliente e
// projeto, em cima do layout v2 atual (sem redesenho: é só mais uma tela do
// casco, como Board e Tarefas).
//
// FILTRO: igual ao Board/Tarefas (Fase N, 8.2.1 item 5). A sidebar é a base
// (cliente + projeto do useNavScope), e a ClienteProjetoFilterBar refina SÓ
// nesta tela. Na mesma linha ficam os chips de tipo, a busca e a ordem.
// Busca-se a lista do cliente efetivo uma vez; tipo/busca/ordem/projeto são
// recortes locais (artifactModel.js explica o porquê).
//
// LISTA: com "Todos os projetos", um grupo por projeto ("CLIENTE / PROJETO ·
// N"); com um projeto escolhido, só a grade.
//
// PAINEL: tocar num cartão abre o artefato no MESMO visualizador do chat
// (Fase V), no escopo/superfície `artefatos`: encaixado à direita em ≥ 1100px
// (o AppV2 soma esta superfície ao `viewerOpen`, e a sidebar vira trilho
// enquanto ele estiver aberto), por cima em 641–1099px e em tela cheia no
// celular. As abas ficam em sessionStorage (useArtifactTabsStorage).
//
// LINKS dentro de um artefato: `openByPath` só existe em escopo de conversa
// (precisa de sessão). Aqui, um link relativo que aponta para outro artefato
// já carregado na lista abre como outra aba; qualquer outro destino abre numa
// aba do NAVEGADOR pela rota `f/` do artefato atual (que serve os vizinhos do
// mesmo projeto, com as mesmas regras de segurança).
import './artifacts.css';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useViewer } from '../viewer/ViewerContext.jsx';
import { SOURCE_ARTIFACT, fileUrl } from '../viewer/viewerApi.js';
import { ViewerDock } from '../viewer/ViewerDock.jsx';
import { ViewerDrawer } from '../viewer/ViewerDrawer.jsx';
import { ViewerFullscreen } from '../viewer/ViewerFullscreen.jsx';
import { ClienteProjetoFilterBar } from '../../layouts/v2/ClienteProjetoFilterBar.jsx';
import { useClienteProjetoFilter } from '../../layouts/v2/useClienteProjetoFilter.js';
import {
  ORDENS,
  SCOPE_ARTEFATOS,
  TIPO_CHIPS,
  filterArtifacts,
  groupByProject,
  resolveArtifactLink,
  sortArtifacts,
  toViewerItem,
} from './artifactModel.js';
import { useArtifacts } from './useArtifacts.js';
import { useArtifactTabsStorage } from './useArtifactTabsStorage.js';
import { ArtifactCard, ArtifactCardSkeleton } from './ArtifactCard.jsx';
import { ArtifactActionsMenu } from './ArtifactActionsMenu.jsx';
import { RenameArtifactDialog } from './RenameArtifactDialog.jsx';
import { removeArtifact } from './artifactsApi.js';
import { ImportArtifactsModal } from './ImportArtifactsModal.jsx';
import { isInScope } from '../../utils/projectTree.js';

const EMPTY_HINT = 'Toque num artefato da lista para abri-lo aqui.';
const SKELETONS = 6;

/**
 * @param {object} props
 * @param {object[]} props.projects
 * @param {string|null} props.selectedClienteId   cliente da sidebar (null = Todos)
 * @param {string|null} props.selectedProjetoId   projeto da sidebar
 * @param {string|null} props.activeSessionKey    conversa ativa ("Citar no chat")
 * @param {boolean} props.isMobile                ≤ 640px
 * @param {boolean} props.isWide                  ≥ 1100px
 * @param {boolean} props.viewerDocked            decisão do useViewerDockCollapse
 * @param {boolean} [props.contentVisible]        celular: a tela está à vista (não o menu)
 */
export function ArtefatosV2({
  projects = [],
  selectedClienteId = null,
  selectedProjetoId: sidebarProjetoId = null,
  activeSessionKey = null,
  isMobile = false,
  isWide = false,
  viewerDocked = false,
  contentVisible = true,
}) {
  const viewer = useViewer();
  useArtifactTabsStorage(viewer);

  const {
    clienteSelectEnabled,
    clientes,
    effectiveClienteId,
    localClienteId,
    setLocalClienteId,
    subProjetoIds,
    selectedProjetoId,
    setSelectedProjetoId,
  } = useClienteProjetoFilter(projects, selectedClienteId, sidebarProjetoId);

  const [tipo, setTipo] = useState('todos');
  const [busca, setBusca] = useState('');
  const [ordem, setOrdem] = useState('recentes');

  const { artifacts, error, reload, upsertLocal, removeLocal } = useArtifacts({
    clienteId: effectiveClienteId,
    signal: viewer?.artifactsSignal ?? 0,
  });

  // Lista recarregada → abas abertas acompanham (título renomeado, arquivo
  // alterado no disco: a versão nova da aba refaz o conteúdo no painel).
  const syncItems = viewer?.syncItems;
  useEffect(() => {
    if (!artifacts || !syncItems) return;
    syncItems(SCOPE_ARTEFATOS, artifacts.map(toViewerItem), { source: SOURCE_ARTIFACT });
  }, [artifacts, syncItems]);

  const visible = useMemo(
    () => sortArtifacts(
      filterArtifacts(artifacts, { clienteId: effectiveClienteId, projetoId: selectedProjetoId, tipo, q: busca }),
      ordem,
    ),
    [artifacts, effectiveClienteId, selectedProjetoId, tipo, busca, ordem],
  );
  const grouped = selectedProjetoId == null;
  const groups = useMemo(
    () => (grouped ? groupByProject(visible, ordem, projects) : null),
    [grouped, visible, ordem, projects],
  );

  const surface = viewer ? viewer.getSurface(SCOPE_ARTEFATOS) : { open: false, fullscreen: false };
  const scopeState = viewer ? viewer.getScope(SCOPE_ARTEFATOS) : null;
  const activeCardId = surface.open ? scopeState?.activeId : null;

  const openArtifact = (artifact) => {
    viewer?.openItem(SCOPE_ARTEFATOS, toViewerItem(artifact), { source: SOURCE_ARTIFACT });
  };

  // Menu ⋯ / toque longo: guarda o artefato e o retângulo da âncora no
  // instante do toque (a lista pode rolar depois; o menu fica onde abriu).
  const [menu, setMenu] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const handleMenu = (artifact, anchor) => {
    const rect = anchor?.getBoundingClientRect?.() || { top: 0, bottom: 0, left: 0, right: 0 };
    setMenu({ artifact, rect });
  };
  const closeMenu = useCallback(() => setMenu(null), []);

  const feedback = (text, kind = 'info') => viewer?.showToast(text, kind);

  const handleRenamed = (updated) => {
    upsertLocal(updated);
    feedback('Artefato renomeado.');
  };

  // "Importar do projeto…": o select do modal oferece os projetos do escopo
  // atual da tela, já com o projeto escolhido (ou o cliente) marcado.
  const [importing, setImporting] = useState(false);
  const importProjects = useMemo(
    () => projects.filter((p) => isInScope(p.id, effectiveClienteId, selectedProjetoId)),
    [projects, effectiveClienteId, selectedProjetoId],
  );
  const handleImported = ({ created, artifacts: imported }) => {
    imported.forEach(upsertLocal);
    if (created > 0) {
      feedback(created === 1 ? '1 artefato importado.' : `${created} artefatos importados.`);
    } else if (imported.length > 0) {
      feedback('Esses arquivos já estavam em Artefatos.');
    }
  };

  const handleRemove = async (artifact) => {
    try {
      await removeArtifact(artifact.artifact_id);
    } catch (err) {
      feedback(err?.message || 'Não consegui remover da lista.', 'error');
      return;
    }
    removeLocal(artifact.artifact_id);
    // A aba aberta dele também sai (fechar a última fecha o painel).
    if (scopeState?.items.some((i) => i.id === artifact.artifact_id)) {
      viewer.closeItem(SCOPE_ARTEFATOS, artifact.artifact_id);
    }
    feedback('Removido da lista. O arquivo continua no projeto.');
  };

  // Link relativo num artefato aberto (ver o cabeçalho do arquivo).
  const handleOpenPath = (caminho, options, item) => {
    if (!item) return;
    const target = resolveArtifactLink(caminho, options);
    if (!target) {
      viewer?.showToast('Esse link aponta para fora do projeto.', 'error');
      return;
    }
    const match = (artifacts || []).find((a) => a.project_id === item.project_id && a.path === target.path);
    if (match) {
      openArtifact(match);
      return;
    }
    window.open(fileUrl(item, target.path), '_blank', 'noopener,noreferrer');
  };

  const filtering = tipo !== 'todos' || busca.trim() !== '';
  const clearFilters = () => {
    setTipo('todos');
    setBusca('');
  };

  const renderCards = (list, baseProjectId) => (
    <div className="af-grid">
      {list.map((artifact) => (
        <ArtifactCard
          key={artifact.artifact_id}
          artifact={artifact}
          active={activeCardId === artifact.artifact_id}
          baseProjectId={baseProjectId}
          onOpen={openArtifact}
          onMenu={handleMenu}
        />
      ))}
    </div>
  );

  let body;
  if (artifacts === null && error) {
    body = (
      <div className="af-empty" role="alert">
        <div className="af-empty-title">Não consegui carregar os artefatos.</div>
        <button type="button" className="af-link" onClick={reload}>Tentar de novo</button>
      </div>
    );
  } else if (artifacts === null) {
    body = (
      <div className="af-grid" aria-busy="true" aria-label="Carregando artefatos" data-testid="artifacts-loading">
        {Array.from({ length: SKELETONS }, (_, i) => <ArtifactCardSkeleton key={i} />)}
      </div>
    );
  } else if (visible.length === 0 && filtering) {
    body = (
      <div className="af-empty" data-testid="artifacts-empty-filter">
        <div className="af-empty-title">Nada encontrado com esses filtros.</div>
        <button type="button" className="af-link" onClick={clearFilters}>Limpar filtros</button>
      </div>
    );
  } else if (visible.length === 0) {
    body = (
      <div className="af-empty" data-testid="artifacts-empty">
        <div className="af-empty-title">Nenhum artefato aqui ainda.</div>
        Quando um agente criar um relatório, documento ou PDF, ele aparece nesta tela.
        {' '}Você também pode{' '}
        <button type="button" className="af-link" onClick={() => setImporting(true)}>Importar do projeto</button>.
      </div>
    );
  } else if (grouped) {
    body = groups.map((group) => (
      <section key={group.projectId} className="af-group" data-testid={`artifacts-group-${group.projectId}`}>
        <h3 className="af-group-label">{group.label} · {group.items.length}</h3>
        {renderCards(group.items, group.projectId)}
      </section>
    ));
  } else {
    body = renderCards(visible, selectedProjetoId);
  }

  return (
    <div className="af-screen" data-testid="artefatos-v2">
      <div className="af-main">
        <ClienteProjetoFilterBar
          clienteSelectEnabled={clienteSelectEnabled}
          clientes={clientes}
          localClienteId={localClienteId}
          onSelectLocalCliente={setLocalClienteId}
          effectiveClienteId={effectiveClienteId}
          subProjetoIds={subProjetoIds}
          selectedProjetoId={selectedProjetoId}
          onSelectProjeto={setSelectedProjetoId}
          projects={projects}
        >
          <div className="af-chips" role="group" aria-label="Tipo de arquivo">
            {TIPO_CHIPS.map((chip) => (
              <button
                key={chip.id}
                type="button"
                className="af-chip"
                aria-pressed={tipo === chip.id}
                onClick={() => setTipo(chip.id)}
              >
                {chip.label}
              </button>
            ))}
          </div>
          <input
            type="search"
            className="af-search"
            placeholder="Buscar artefatos"
            aria-label="Buscar artefatos (título, caminho e descrição)"
            value={busca}
            onChange={(event) => setBusca(event.target.value)}
            enterKeyHint="search"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          <select
            className="af-order"
            aria-label="Ordenar artefatos"
            value={ordem}
            onChange={(event) => setOrdem(event.target.value)}
          >
            {ORDENS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </ClienteProjetoFilterBar>

        <div className="af-scroll" data-testid="artifacts-scroll">
          {body}
          {artifacts !== null && visible.length > 0 && (
            <div className="af-footer">
              <button type="button" className="af-import" onClick={() => setImporting(true)}>
                ＋ Importar do projeto…
              </button>
              <span className="af-hint">Toque num cartão para abrir no painel lateral.</span>
            </div>
          )}
        </div>
      </div>

      {viewerDocked && (
        <ViewerDock
          scope={SCOPE_ARTEFATOS}
          hidden={surface.fullscreen}
          emptyHint={EMPTY_HINT}
          onOpenPath={handleOpenPath}
        />
      )}
      {!isMobile && !isWide && (
        <ViewerDrawer
          scope={SCOPE_ARTEFATOS}
          open={surface.open && !surface.fullscreen}
          emptyHint={EMPTY_HINT}
          onOpenPath={handleOpenPath}
        />
      )}
      <ViewerFullscreen
        scope={SCOPE_ARTEFATOS}
        open={surface.fullscreen && contentVisible}
        closeEverything={isMobile}
        emptyHint={EMPTY_HINT}
        onOpenPath={handleOpenPath}
      />

      {menu && (
        <ArtifactActionsMenu
          artifact={menu.artifact}
          anchorRect={menu.rect}
          projects={projects}
          activeSessionKey={activeSessionKey}
          onClose={closeMenu}
          onOpen={openArtifact}
          onRename={setRenaming}
          onRemove={handleRemove}
          onFeedback={feedback}
        />
      )}
      {importing && (
        <ImportArtifactsModal
          projects={importProjects}
          allProjects={projects}
          initialProjectId={selectedProjetoId ?? effectiveClienteId}
          onClose={() => setImporting(false)}
          onImported={handleImported}
        />
      )}
      {renaming && (
        <RenameArtifactDialog
          artifact={renaming}
          onClose={() => setRenaming(null)}
          onRenamed={handleRenamed}
        />
      )}
    </div>
  );
}
