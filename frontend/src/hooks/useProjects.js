// frontend/src/hooks/useProjects.js
// Milestone 2 (plano Layout v2, 05-TL.md, Tarefa 12): extraído de
// layouts/v1/AppV1.jsx (onde vivia como função local desde o Milestone 1)
// para este módulo compartilhado — layouts/v2/AppV2.jsx precisa da mesma
// lista de projetos e não deveria duplicar a lógica de fetch. AppV1.jsx
// importa daqui também (ver Tarefa 12), sem mudança de comportamento.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api.js';

export function useProjects() {
  const [projects, setProjects] = useState([]);
  const refreshProjects = useCallback(
    () => api.fetchProjects().then(setProjects).catch(console.error),
    []
  );
  useEffect(() => { refreshProjects(); }, [refreshProjects]);
  return [projects, refreshProjects];
}
