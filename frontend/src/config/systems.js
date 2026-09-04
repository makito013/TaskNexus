// frontend/src/config/systems.js
// Fonte única de verdade dos "sistemas" navegáveis via App Launcher
// (SystemSwitcherModal / AppLauncherHeader, ainda não construídos).
// `icone` é só um identificador string por enquanto — quem decide o
// tratamento visual real (glifo, SVG, primitivo desenhado) é o componente
// que consumir este array, não este arquivo de dados.

// A entrada `board` (rota `/board`) saiu junto com a tela v1 que ela abria: o
// Board agora é uma área DENTRO do Escritório (layouts/v2/BoardV2.jsx), não um
// sistema próprio do launcher.
export const SYSTEMS = [
  { id: 'tarefas', nome: 'Tarefas', rota: '/tarefas', icone: 'tarefas' },
  { id: 'escritorio', nome: 'Escritório', rota: '/', icone: 'escritorio' },
];

/**
 * Retorna a entrada de SYSTEMS cuja `rota` bate com o pathname atual.
 * Útil para o header saber qual ícone/nome mostrar como "sistema atual".
 *
 * Ordem de checagem importa: `/` é prefixo de qualquer rota, então é
 * comparada por igualdade estrita (não startsWith) para não capturar
 * `/tarefas` erroneamente.
 *
 * Devolve `undefined` para qualquer rota fora da lista — inclusive a `/board`
 * retirada. Quem consome PRECISA tolerar isso (ver AppLauncherHeader.jsx).
 */
export function getSystemByRoute(pathname) {
  return SYSTEMS.find((s) => s.rota === pathname);
}
