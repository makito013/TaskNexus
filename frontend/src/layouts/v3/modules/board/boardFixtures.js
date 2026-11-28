// Shared fixtures of the board tests (not a suite: the name has no .test).
import { buildRegistryIndex } from '../projects/registryIndex.js'

const folder = (id, path) => ({ id, path, is_primary: true, position: 0, exists: true })
const project = (id, key, name, extra = {}) => ({
  id, key, name, origin: 'seed', archived: false, primary_locked: false, folders: [folder(id, `D:\\projetos\\${key}`)], ...extra,
})

export const REGISTRY_RESPONSE = {
  seeded: null,
  workspaces: [
    {
      id: 1, key: 'Pessoal', name: 'Pessoal', origin: 'seed', archived: false,
      projects: [
        project(1, 'Pessoal/tn-sandbox', 'tn-sandbox'),
        project(2, 'Pessoal/silent-a', 'silent-a'),
        project(4, 'Pessoal/old', 'old', { archived: true }),
      ],
    },
    { id: 2, key: 'podesubir', name: 'podesubir', origin: 'seed', archived: false, projects: [project(5, 'podesubir/ymci', 'ymci')] },
    { id: 3, key: '.w3', name: 'Estudos', origin: 'user', archived: false, projects: [] },
    {
      id: 4, key: 'Velho', name: 'Velho', origin: 'seed', archived: true,
      projects: [project(7, 'Velho/legacy', 'legacy')],
    },
  ],
}

export const registry = () => buildRegistryIndex(REGISTRY_RESPONSE)

export const COLUMNS = [
  { slug: 'a_fazer', label: 'A fazer', position: 1, is_done: false },
  { slug: 'em_andamento', label: 'Em andamento', position: 2, is_done: false },
  { slug: 'feito', label: 'Feito', position: 3, is_done: true },
]

export const card = (id, projeto_id, extra = {}) => ({
  id,
  titulo: `Card ${id}`,
  projeto_id,
  parent_id: null,
  status: 'a_fazer',
  origem: 'bruno',
  ultima_atualizacao_por: 'bruno',
  descricao: null,
  criado_em: 1000 + id,
  atualizado_em: 1000 + id,
  tipo: null,
  prazo: null,
  prioridade: null,
  board_position: id,
  imagens: [],
  subcards: [],
  subcards_resumo: null,
  questions: [],
  ...extra,
})

// A spread of places: a registered project, a workspace root, an unregistered
// sub-folder, a stray bucket, a key that does not exist, and two archived ones.
export const CARDS = [
  card(1, 'Pessoal/tn-sandbox'),
  card(2, 'Pessoal'),
  card(3, 'Pessoal/lab-voz'),
  card(4, 'NewCo/x'),
  card(5, '.w9/.p9'),
  card(6, 'podesubir/ymci', { status: 'feito' }),
  card(7, 'Pessoal/old'),
  card(8, 'Velho/legacy'),
  card(9, 'Velho'),
  card(10, '.w3'),
]
