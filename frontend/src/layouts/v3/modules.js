import { PET_NAMES } from './components/Pet/petShapes.js'

export { PET_NAMES }

// The only route table of the v3 shell. Order is the order of the module rail.
//   ready:           the module has a real screen (the others render ComingSoon)
//   islandMessage:   static phrase of the island while the module has no live data
//   comingSoonCopy:  text of the ComingSoon panel (pet voice), only for !ready modules
export const MODULES = [
  {
    id: 'home',
    pet: 'bit',
    path: '/home',
    label: 'Início',
    ariaLabel: 'Início, em breve',
    ready: false,
    islandMessage: 'Ainda não abri o Início. Volto logo.',
    comingSoonCopy:
      'Ainda estou me arrumando. Quando eu acordar, resumo o seu dia e chamo o colega certo.',
  },
  {
    id: 'tasks',
    pet: 'tiq',
    path: '/tasks',
    label: 'Tarefas',
    ariaLabel: 'Tarefas',
    ready: true,
    islandMessage: 'Pronto pra cuidar das suas tarefas.',
    comingSoonCopy: null,
  },
  {
    id: 'finance',
    pet: 'fin',
    path: '/finance',
    label: 'Finanças',
    ariaLabel: 'Finanças, em breve',
    ready: false,
    islandMessage: 'Ainda não cheguei por aqui.',
    comingSoonCopy:
      'Ainda não cheguei. Quando eu acordar, falo de dinheiro com calma e peço sua aprovação antes de mexer em algo.',
  },
  {
    id: 'projects',
    pet: 'kan',
    path: '/projects',
    label: 'Projetos',
    ariaLabel: 'Projetos e agentes, em breve',
    ready: false,
    islandMessage: 'Ainda não abri minha tela.',
    comingSoonCopy:
      'Ainda não abri minha tela. Por enquanto, seus projetos e agentes ficam no layout atual: inicie o TaskNexus sem --v3 pra usá-los.',
  },
  {
    id: 'browser',
    pet: 'navi',
    path: '/browser',
    label: 'Navegador',
    ariaLabel: 'Navegador, em breve',
    ready: false,
    islandMessage: 'Ainda estou me preparando.',
    comingSoonCopy:
      'Ainda estou me preparando. Quando eu acordar, pesquiso, leio a página inteira e volto com resumo e links.',
  },
]

export const DEFAULT_MODULE_ID = 'tasks'

export function moduleById(id) {
  return MODULES.find((module) => module.id === id) || null
}

// Module that owns a pathname (a trailing slash is ignored), or null.
export function moduleForPath(pathname) {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  return MODULES.find((module) => module.path === normalized) || null
}

// Every module but the active one, in rail order.
export function colleaguesOf(moduleId) {
  return MODULES.filter((module) => module.id !== moduleId)
}
