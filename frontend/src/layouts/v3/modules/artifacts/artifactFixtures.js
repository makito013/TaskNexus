// Shared fixtures of the artifacts tests (not a suite: the name has no .test).
import { buildRegistryIndex } from '../projects/registryIndex.js'

const folder = (id, path, primary = true) => ({ id, path, is_primary: primary, position: 0, exists: true })
const project = (id, key, name, extra = {}) => ({
  id, key, name, origin: 'seed', archived: false, primary_locked: false, folders: [folder(id, `/work/${key}`)], ...extra,
})

export const REGISTRY_RESPONSE = {
  seeded: null,
  workspaces: [
    {
      id: 1, key: 'Pessoal', name: 'Pessoal', origin: 'seed', archived: false,
      projects: [
        project(1, 'Pessoal/tn-sandbox', 'tn-sandbox'),
        project(2, 'Pessoal/.p37', 'Docs'),
        project(3, 'Pessoal/old', 'old', { archived: true }),
      ],
    },
    {
      id: 2, key: '.w12', name: 'Estudos', origin: 'user', archived: false,
      projects: [
        project(4, '.w12/.p38', 'Lab', { folders: [folder(4, '/work/lab'), folder(5, '/work/lab-extra', false)] }),
      ],
    },
    { id: 3, key: 'Velho', name: 'Velho', origin: 'seed', archived: true, projects: [project(6, 'Velho/legacy', 'legacy')] },
  ],
}

export const registry = () => buildRegistryIndex(REGISTRY_RESPONSE)

// A row of GET /api/artifacts.
export const artifact = (id, projectId, extra = {}) => ({
  artifact_id: `a${id}`,
  project_id: projectId,
  path: `docs/file-${id}.md`,
  title: `Artifact ${id}`,
  kind: 'markdown',
  description: null,
  excerpt: null,
  exists: true,
  size: 2048,
  mtime: 1_700_000_000 + id,
  updated_at: 1_700_000_000 + id,
  created_by: 'agent',
  agent_label: 'claude',
  ...extra,
})

// A spread of places: a registered project, a workspace root keyed like the workspace (a minted one),
// a minted project, an unregistered sub-folder, a stray bucket, a key that does not exist and an archived one.
export const ARTIFACTS = [
  artifact(1, 'Pessoal/tn-sandbox', { title: 'Relatório Q3', path: 'docs/q3.md' }),
  artifact(2, 'Pessoal/.p37', { title: 'Plan', path: 'plan.md', kind: 'html' }),
  artifact(3, '.w12/.p38', { title: 'Lab notes', path: 'notes.md' }),
  artifact(4, '.w12', { title: 'Workspace readme', path: 'README.md' }),
  artifact(5, 'Pessoal/lab-voz', { title: 'Voice lab', path: 'voz.pdf', kind: 'pdf' }),
  artifact(6, 'NewCo/x', { title: 'Stray', path: 'stray.md' }),
  artifact(7, '.w9/.p9', { title: 'Ghost', path: 'ghost.md' }),
  artifact(8, 'Pessoal/old', { title: 'Old thing', path: 'old.md' }),
  artifact(9, 'Velho/legacy', { title: 'Legacy doc', path: 'legacy.md' }),
]
