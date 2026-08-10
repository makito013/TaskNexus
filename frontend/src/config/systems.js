// frontend/src/config/systems.js
// Fonte única de verdade dos "sistemas" navegáveis via App Launcher
// (SystemSwitcherModal / AppLauncherHeader, ainda não construídos).
// `icone` é só um identificador string por enquanto — quem decide o
// tratamento visual real (glifo, SVG, primitivo desenhado) é o componente
// que consumir este array, não este arquivo de dados.

export const SYSTEMS = [
  { id: 'tarefas', nome: 'Tarefas', rota: '/tarefas', icone: 'tarefas' },
  { id: 'board', nome: 'Board', rota: '/board', icone: 'board' },
  { id: 'escritorio', nome: 'Escritório', rota: '/', icone: 'escritorio' },
];

/**
 * Retorna a entrada de SYSTEMS cuja `rota` bate com o pathname atual.
 * Útil para o header saber qual ícone/nome mostrar como "sistema atual".
 *
 * Ordem de checagem importa: `/` é prefixo de qualquer rota, então é
 * comparada por igualdade estrita (não startsWith) para não capturar
 * `/tarefas` ou `/board` erroneamente.
 */
export function getSystemByRoute(pathname) {
  return SYSTEMS.find((s) => s.rota === pathname);
}
