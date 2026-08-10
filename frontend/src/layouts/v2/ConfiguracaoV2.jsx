// frontend/src/layouts/v2/ConfiguracaoV2.jsx
// Tela "Configuração" do layout v2 (o item de nav mantém o id interno
// `agentes` — só o rótulo visível mudou): grid de cards dos agentes globais
// com CRUD COMPLETO (criar/editar/excluir) usando o hook compartilhado
// `useAgentSettings` (hooks/useAgentSettings.js), mais o seletor de pasta de
// projetos (ProjectsRootSetting) no rodapé.
//
// Esta tela substituiu a antiga tela de agentes do layout v1 (o modal
// components/AgentSettingsModal.jsx, já apagado): tudo o que só dava pra
// fazer lá — editar e excluir agente, escolher a pasta de projetos — existe
// aqui, agora ao lado da criação que o v2 já tinha.
//
// Formulário: `AgentForm` (components/AgentForm.jsx) veio daquele modal, com
// a mesma validação e o mesmo payload. `AgentForm` usa ids de DOM
// fixos (`agent-id`, `agent-nome`, …), então existe no máximo UM formulário
// montado por vez: `formTarget` (null | 'new' | agent) é a única fonte de
// verdade disso, nunca um formulário por card.
//
// Toggle "ativo/pausado": o modelo `Agent` (backend/app/models.py) não tem
// nenhum campo desse tipo — nada de banco foi inventado para isso (instrução
// explícita do TL). O toggle abaixo é puramente visual, sempre "Ativo",
// desabilitado, com `title` explicando a limitação.
//
// "Descrição": o modelo também não tem um campo de descrição dedicado — o
// campo mais próximo é `papel`, que já é o texto livre que o formulário usa
// para esse propósito (ex.: "Assistente"); reaproveitado aqui como a
// descrição do card, sem inventar campo novo.

import { useState } from 'react';
import { useAgentSettings } from '../../hooks/useAgentSettings.js';
import { AgentForm } from '../../components/AgentForm.jsx';
import { ProjectsRootSetting } from '../../components/ProjectsRootSetting.jsx';
import { NotificationSettings } from '../../components/NotificationSettings.jsx';

const styles = {
  page: {
    flex: 1,
    overflowY: 'auto',
    background: 'var(--v2-bg)',
    padding: '20px',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    marginBottom: '16px',
  },
  title: {
    fontSize: '16px',
    fontWeight: 600,
    color: 'var(--v2-text)',
  },
  addBtn: {
    flexShrink: 0,
    padding: '9px 14px',
    borderRadius: '8px',
    border: '1px solid var(--v2-accent)',
    background: 'var(--v2-accent-soft)',
    color: 'var(--v2-accent-strong)',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  formCard: {
    background: 'var(--v2-surface)',
    border: '1px solid var(--v2-border)',
    borderRadius: '12px',
    padding: '20px',
    maxWidth: '480px',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
    gap: '14px',
  },
  card: {
    background: 'var(--v2-surface)',
    border: '1px solid var(--v2-border)',
    borderRadius: '12px',
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
  },
  name: {
    fontSize: '14px',
    fontWeight: 600,
    color: 'var(--v2-text)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  toggle: {
    flexShrink: 0,
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '4px 10px',
    borderRadius: '999px',
    fontSize: '10px',
    fontWeight: 600,
    background: 'var(--v2-accent-soft)',
    color: 'var(--v2-accent-strong)',
    cursor: 'default',
  },
  toggleDot: {
    width: '7px',
    height: '7px',
    borderRadius: '50%',
    background: 'var(--v2-accent)',
  },
  description: {
    fontSize: '12px',
    color: 'var(--v2-text-dim)',
    lineHeight: 1.4,
  },
  cmd: {
    fontSize: '11px',
    color: 'var(--v2-text-faint)',
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  tags: {
    display: 'flex',
    gap: '6px',
    flexWrap: 'wrap',
  },
  tag: {
    fontSize: '10px',
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
    color: 'var(--v2-text-dim)',
    background: 'var(--v2-surface-2)',
    border: '1px solid var(--v2-border)',
    borderRadius: '6px',
    padding: '3px 8px',
    textTransform: 'lowercase',
  },
  empty: {
    margin: 'auto',
    textAlign: 'center',
    color: 'var(--v2-text-faint)',
    fontSize: '13px',
    padding: '48px 24px',
  },
  cardActions: {
    display: 'flex',
    gap: '6px',
    flexShrink: 0,
  },
  iconBtn: {
    width: '32px',
    height: '32px',
    borderRadius: '8px',
    border: '1px solid var(--v2-border)',
    background: 'transparent',
    color: 'var(--v2-text)',
    fontSize: '13px',
    lineHeight: 1,
    cursor: 'pointer',
  },
  projectsRootSection: {
    marginTop: '24px',
    maxWidth: '480px',
  },
  deleteError: {
    marginBottom: '12px',
    fontSize: '12px',
    color: 'var(--state-attention, var(--v2-danger, #ff3333))',
  },
};

/** `onAgentsChanged` (AppV2 passa `refreshProjects`): /api/agents e
 * /api/projects são endpoints DIFERENTES — useAgentSettings recarrega
 * sozinho só a lista de agentes, mas a lista de projetos embute os agentes
 * disponíveis por projeto (usada pelas superfícies de "novo chat"). Sem esse
 * aviso, um agente excluído aqui continuaria oferecido como opção de novo
 * chat até um reload manual. */
export function ConfiguracaoV2({ onAgentsChanged }) {
  const { agents, loading, createAgent, updateAgent, deleteAgent } = useAgentSettings();
  // null = lista | 'new' = criando | objeto do agente = editando.
  // UM formulário montado por vez (AgentForm usa ids de DOM fixos).
  const [formTarget, setFormTarget] = useState(null);
  // Erro de EXCLUSÃO só (não reaproveita o `error` do AgentForm — aquele
  // vive dentro do form, este vive na lista, os dois nunca aparecem juntos
  // porque form e lista são mutuamente exclusivos).
  const [deleteError, setDeleteError] = useState(null);

  // Achado do QA: setFormTarget cru deixava um deleteError antigo grudado
  // na tela — abrir "Novo agente"/"Editar", cancelar ou salvar com sucesso
  // não limpava o erro de uma exclusão anterior, que reaparecia sem relação
  // com a operação em curso assim que o form fechasse. Único ponto de troca
  // de `formTarget` a partir daqui — nenhuma chamada direta a
  // `setFormTarget` sobrevive fora desta função.
  const openForm = (target) => {
    setDeleteError(null);
    setFormTarget(target);
  };

  // Falha aqui NÃO deve virar "falha ao salvar agente" pro usuário — o
  // agente já foi criado/atualizado com sucesso antes desta chamada rodar,
  // é só o refresh de /api/projects que falhou. Engolida com aviso no
  // console em vez de propagar pro catch de handleSubmit (que reportaria a
  // mensagem errada dentro do AgentForm).
  const notifyChanged = async () => {
    if (!onAgentsChanged) return;
    try {
      await onAgentsChanged();
    } catch (e) {
      console.warn('[ConfiguracaoV2] onAgentsChanged (refresh de /api/projects) falhou depois de salvar o agente com sucesso:', e);
    }
  };

  // NÃO passar createAgent/updateAgent direto como `onSubmit`: a aridade é
  // diferente (createAgent(payload) vs updateAgent(id, payload)). Este
  // wrapper decide qual chamar e só então avisa o caller. Só a mutação em si
  // (create/update) deve propagar erro pro AgentForm — notifyChanged trata
  // o próprio erro internamente, então nunca chega a este catch.
  const handleSubmit = async (payload) => {
    if (formTarget && formTarget !== 'new') {
      await updateAgent(formTarget.id, payload);
    } else {
      await createAgent(payload);
    }
    await notifyChanged();
  };

  const handleDelete = async (agent) => {
    if (!window.confirm(`Remover o agente "${agent.nome}"? Isso não afeta chats já abertos.`)) return;
    setDeleteError(null);
    try {
      await deleteAgent(agent.id);
      await notifyChanged();
    } catch (e) {
      setDeleteError(e.message || `Falha ao remover o agente "${agent.nome}".`);
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <span style={styles.title}>
          {/* Nunca "Agentes" sozinho aqui: o nav já usa esse rótulo pra tela
              inteira ("Configuração") — repetir um nome diferente pro mesmo
              conteúdo, empilhado no mesmo lugar, lia como duas telas
              diferentes. "Agentes cadastrados" deixa claro que é a SEÇÃO de
              agentes dentro da tela de Configuração, não uma tela própria. */}
          {formTarget ? (formTarget === 'new' ? 'Novo agente' : `Editar ${formTarget.nome}`) : 'Agentes cadastrados'}
        </span>
        {!formTarget && (
          <button type="button" style={styles.addBtn} onClick={() => openForm('new')}>
            + Novo agente
          </button>
        )}
      </div>

      {deleteError && !formTarget && (
        <div role="alert" style={styles.deleteError}>{deleteError}</div>
      )}

      {formTarget ? (
        <div style={styles.formCard}>
          <AgentForm
            agent={formTarget === 'new' ? null : formTarget}
            onCancel={() => openForm(null)}
            onSaved={() => openForm(null)}
            onSubmit={handleSubmit}
          />
        </div>
      ) : loading ? (
        <div style={styles.empty}>Carregando...</div>
      ) : agents.length === 0 ? (
        <div style={styles.empty}>
          Nenhum agente cadastrado ainda. Use "+ Novo agente" para adicionar um.
        </div>
      ) : (
      <div style={styles.grid}>
        {agents.map((agent) => (
          <div key={agent.id} style={styles.card} data-testid={`agentes-v2-card-${agent.id}`}>
            <div style={styles.cardHeader}>
              <span style={styles.name}>{agent.nome}</span>
              <span
                style={styles.toggle}
                title="Todo agente cadastrado roda sob demanda quando um chat é aberto — o backend não tem um conceito de agente 'pausado', então este indicador é sempre 'Ativo'."
              >
                <span style={styles.toggleDot} />
                Ativo
              </span>
            </div>

            {/* `papel` aparece só UMA vez no card, como descrição — antes
                também virava uma tag ao lado de `ia`, duplicando o mesmo
                dado com dois tratamentos visuais diferentes no mesmo card. */}
            {agent.papel && <div style={styles.description}>{agent.papel}</div>}
            <div style={styles.cmd}>{(agent.cmd || []).join(' ')}</div>

            <div style={styles.tags}>
              <span style={styles.tag}>{agent.ia}</span>
            </div>

            <div style={styles.cardActions}>
              <button
                type="button"
                style={styles.iconBtn}
                aria-label={`Editar ${agent.nome}`}
                onClick={() => openForm(agent)}
              >
                ✎
              </button>
              <button
                type="button"
                style={styles.iconBtn}
                aria-label={`Remover ${agent.nome}`}
                onClick={() => handleDelete(agent)}
              >
                🗑
              </button>
            </div>
          </div>
        ))}
      </div>
      )}

      {/* Fora do card de formulário: a pasta de projetos é uma configuração
          da instalação, não um campo do agente sendo editado. Fica montada
          também com o formulário aberto — é a única entrada dessa
          configuração desde que a tela v1 foi aposentada. */}
      <div style={styles.projectsRootSection}>
        <ProjectsRootSetting />
        {/* Same "installation settings" band as the folder picker: not an
            agent field at all, applies to the whole app. */}
        <NotificationSettings />
      </div>
    </div>
  );
}
