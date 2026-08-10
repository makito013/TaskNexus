// frontend/src/hooks/useAgentSettings.js
// Milestone 3 (plano Layout v2, 05-TL.md, Tarefa 16): extraído de
// components/AgentSettingsModal.jsx (onde a lógica de fetch/create/update/
// delete vivia solta dentro do componente) para este hook compartilhado —
// layouts/v2/ConfiguracaoV2.jsx precisa dos MESMOS dados/ações (CRUD de agentes
// globais via /api/agents) sem duplicar a lógica. (O modal v1 de origem
// também passou a consumir este hook antes de ser aposentado — a extração
// foi refatoração pura, sem mudança de comportamento observável: mesmos
// payloads, mesmos erros propagados para o form tratar.)
//
// Decisão: create/update/delete recarregam a lista inteira (`load()`) após
// resolver, em vez de aplicar a resposta da mutação ao estado local (padrão
// "otimista" de useCards.js). Diferença deliberada: a lista de agentes é
// pequena e muda raramente (edição manual via formulário, não polling de
// fundo), e o comportamento ANTERIOR de AgentSettingsModal.jsx já fazia
// exatamente isso (`await load()` dentro de `handleChanged`) — preservar essa
// escolha evita qualquer mudança de comportamento observável ao migrar.
//
// Erros de mutação NÃO são engolidos aqui: propagam para quem chamou (o
// AgentForm (components/AgentForm.jsx) já captura e mostra
// `e.message` inline) — mesmo contrato de erro que existia antes da extração.
import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api.js';

export function useAgentSettings() {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => (
    api.fetchAgents().then(setAgents).catch(() => setAgents([])).finally(() => setLoading(false))
  ), []);

  useEffect(() => { load(); }, [load]);

  const createAgent = useCallback(async (payload) => {
    const created = await api.createAgent(payload);
    await load();
    return created;
  }, [load]);

  const updateAgent = useCallback(async (id, payload) => {
    const updated = await api.updateAgent(id, payload);
    await load();
    return updated;
  }, [load]);

  const deleteAgent = useCallback(async (id) => {
    const result = await api.deleteAgent(id);
    await load();
    return result;
  }, [load]);

  return { agents, loading, load, createAgent, updateAgent, deleteAgent };
}
