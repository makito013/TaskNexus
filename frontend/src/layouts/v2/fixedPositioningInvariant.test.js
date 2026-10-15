// frontend/src/layouts/v2/fixedPositioningInvariant.test.js
//
// Rodada 2, Frente B — a única defesa AUTOMÁTICA contra o modo de falha mais
// caro desta rodada (risco B-R1 do plano).
//
// A invariante: `transform`, `filter`/`backdrop-filter`, `will-change` e
// `contain` criam um containing block para descendentes `position: fixed`.
// O FAB de atalhos do terminal (TerminalShortcutsFab.jsx) e o painel que ele
// abre são `fixed` e se posicionam por `left`/`top` em px calculados contra a
// VIEWPORT (utils/fabGeometry.js); o casco do app (AppV2.jsx +
// hooks/useVisibleViewportShell.js) é `fixed` pelo mesmo motivo. Basta UMA
// dessas 4 propriedades em UM nó da cadeia de ancestrais para que todos esses px
// passem a ser medidos a partir daquele nó — e o sintoma é o FAB e o casco no
// lugar errado, **sem erro, sem warning e sem nenhum outro teste vermelho**.
// Nenhum teste de DOM pega isso: jsdom não resolve containing blocks.
//
// Por que este teste LÊ O FONTE, o que não tem precedente neste repo: a
// propriedade ofensora não precisa estar ativa em runtime para quebrar — basta
// existir na regra que se aplica ao nó. Não há como observá-la a partir do DOM
// renderizado num ambiente sem engine de layout. Ler o texto dos arquivos que
// estilizam a cadeia é a única checagem possível, e é barata.
//
// COMO ELE FUNCIONA (e por que não dá falso positivo nos usos legítimos):
//  - comentários (`/* */`, `//`) são removidos antes da varredura, então a prosa
//    que EXPLICA a proibição não se autodenuncia;
//  - blocos `@keyframes { … }` são removidos: um `transform` dentro de um
//    keyframe não é uma declaração aplicada a um nó da cadeia (index.css tem
//    `@keyframes bounce` e theme.css tem os keyframes do FAB);
//  - a varredura olha só o NOME da propriedade de cada declaração, nunca o
//    valor. É isso que absolve `text-transform: uppercase` (nome diferente) e
//    `transition: opacity 150ms, transform 120ms` (a propriedade é `transition`;
//    `transition: transform` NÃO cria containing block).
//
// Se este teste falhar, a saída correta quase nunca é adicionar exceção: é achar
// outro jeito de fazer o efeito visual (animar `opacity`, usar `box-shadow`,
// mover o efeito para um nó que não seja ancestral do FAB).
import { describe, it, expect } from 'vitest';
import {
  FORBIDDEN_PROPERTIES,
  declaredPropertyNames,
  readSourceRelativeTo,
} from '../../test/fixedPositioningScan.js';

// Os arquivos que estilizam algum dos nós da cadeia, de `html` até o nó do
// `term.open()`. A lista é deliberadamente por ARQUIVO e não por nó: um seletor
// novo dentro de um destes arquivos é quase sempre um nó novo na mesma cadeia, e
// uma lista por nó daria a falsa impressão de precisão que um regex não tem.
//
// O QUE O PARSER ENXERGA DENTRO DE HTML (medido, não suposto — vale para a
// primeira entrada da lista, a única que sai de `src/`):
//  - o conteúdo de `<style>` é varrido de VERDADE. Injeções que este teste pega
//    hoje em `index.html`: `transform` na regra `html, body`, `will-change` numa
//    regra `#root` nova, `content-visibility`, `contain` colado na mesma linha
//    da tag. Não é vigilância de fachada;
//  - atributo `style="…"` inline NÃO é vigiado de forma confiável, e isso é um
//    limite ACEITO, não um bug a corrigir. Com UMA declaração
//    (`<div id="root" style="transform: none">`) o candidato a nome carrega o
//    `<div id="root" style="` inteiro e é rejeitado pelo guard de espaço; com
//    DUAS, a segunda é pega por acidente do split em `;`. Ou seja: a detecção
//    de `style=` inline é arbitrária. Fechar isso exigiria um parser de
//    atributos HTML — desproporcional para um arquivo em que hoje NENHUM
//    elemento tem atributo `style` (nem `<body>` nem `#root`). Se algum dia
//    tiver, mova a declaração para o `<style>` acima, que é vigiado.
const CHAIN_SOURCES = [
  // o `<style>` inline que pinta `html, body` antes do JS montar — dois nós da
  // cadeia estilizados fora de qualquer arquivo `.css`
  '../../../index.html',
  // html, body, #root, .app-root, .app-shell-routed-content
  '../../index.css',
  // o div flex-column do shell e o container roteado
  '../../App.jsx',
  // tokens --v2-* e as classes v2 aplicadas a nós da cadeia (`.v2-terminal-frame`)
  './theme.css',
  // o nó raiz `position: fixed` do layout v2 + a topbar e as áreas de conteúdo
  './AppV2.jsx',
  // `SHELL_BASE_RECT_STYLE` + as escritas imperativas de `left`/`top`/`width`/
  // `height` no MESMO nó raiz do AppV2: declara estilo de um nó da cadeia fora
  // do JSX, que é exatamente a lacuna que a entrada do `index.html` fecha do
  // outro lado
  '../../hooks/useVisibleViewportShell.js',
  // o container do chat e o container do TerminalPanel
  './ChatV2.jsx',
  // `skin.root` / `skin.frame` / `skin.viewport` — os 3 últimos nós antes do xterm
  '../../components/terminalSkin.js',
  // onde os nós do skin são montados
  '../../components/TerminalPanel.jsx',
];

describe('fixed-positioning invariant on the layout chain', () => {
  it.each(CHAIN_SOURCES)(
    'declares no containing-block-creating property in %s',
    (relativePath) => {
      const offenders = declaredPropertyNames(readSourceRelativeTo(import.meta.url, relativePath))
        .filter((name) => FORBIDDEN_PROPERTIES.has(name));

      // A mensagem de falha nomeia a propriedade porque quem esbarrar nisto
      // provavelmente não sabe que ela quebra `position: fixed` — o efeito é a
      // 3ª ordem de consequência de um CSS aparentemente inofensivo.
      expect(
        offenders,
        // Sem contagem no texto ("essas 4 propriedades") de propósito: a lista
        // cresce, e um número embutido na mensagem de falha envelhece calado.
        `${relativePath} declara ${offenders.join(', ')}: qualquer uma das `
        + 'propriedades de FORBIDDEN_PROPERTIES num nó da cadeia de layout cria '
        + 'containing block e faz o FAB de atalhos e o casco `position: fixed` se '
        + 'posicionarem contra ESSE nó em vez da viewport, silenciosamente.'
      ).toEqual([]);
    }
  );

  it('would catch a forbidden property if one were introduced', () => {
    // Um teste de invariante que nunca foi visto falhar não vale nada: este
    // exercita o detector com CADA nome de FORBIDDEN_PROPERTIES e com os usos
    // legítimos que ele PRECISA absolver, senão a primeira falha real seria
    // atribuída a um bug do próprio detector.
    //
    // Por que há um caso por NOME e não por propriedade: quando a lista foi
    // ampliada (autônomos, `container-type`, prefixadas), a ampliação dava ZERO
    // ofensores contra o código do repo — ou seja, era indistinguível de um
    // no-op. É esta bateria que torna cada nome novo verificável: apagar
    // qualquer entrada da `Set` acima derruba o caso correspondente aqui.
    const forbidden = [
      '.a { transform: translateY(-120px); }',
      '.b { filter: blur(2px); }',
      '.c { backdrop-filter: saturate(180%); }',
      '.d { will-change: transform; }',
      '.e { contain: layout paint; }',
      "const style = { willChange: 'transform' };",
      "const style = { transform: `translate3d(${dx}px, ${dy}px, 0)` };",
      // `backdropfilter` era a ÚNICA entrada da `Set` sem caso próprio nesta
      // bateria — medido, não suposto: trocá-la por `backdropfiltr` deixava a
      // suíte inteira verde. Era o buraco mais caro possível de deixar aberto,
      // porque esta é justamente a grafia que este repo tende a escrever (a
      // cadeia v2 é estilizada por objetos de estilo JS, e o próprio comentário
      // da `Set` observa que o Safari ainda exige a forma prefixada para efeito
      // de vidro — quem for tentar o efeito escreve `backdropFilter` primeiro).
      "const style = { backdropFilter: 'blur(8px)' };",

      // Os autônomos e parentes da ampliação, em CSS.
      '.f { perspective: 800px; }',
      '.g { content-visibility: auto; }',
      '.h { container-type: inline-size; }',
      '.i { translate: 0 -120px; }',
      '.j { rotate: 45deg; }',
      '.k { scale: 1.02; }',

      // As duas hifenizadas novas na grafia de objeto JS. `translate`/`rotate`/
      // `scale`/`perspective` não precisam de par: a chave JS é a MESMA palavra,
      // então já são cobertas pelos casos de CSS acima.
      "const style = { contentVisibility: 'auto' };",
      "const style = { containerType: 'inline-size' };",

      // O FALSO POSITIVO DOCUMENTADO, asseverado de propósito: uma chave de
      // objeto JS chamada `scale` é acusada mesmo não sendo estilo. Está aqui,
      // e não em `allowed`, porque é o comportamento REAL do detector — deixá-lo
      // fora faria a próxima pessoa tratar a acusação como bug do parser em vez
      // de ler o parágrafo da `Set` que manda renomear a chave.
      'const geometry = { scale: 1 };',

      // Prefixadas em CSS, uma por literal da `Set` (ver o CRITÉRIO lá).
      '.l { -webkit-transform: translateZ(0); }',
      '.m { -moz-transform: translateZ(0); }',
      '.n { -ms-transform: translateZ(0); }',
      '.o { -o-transform: translateZ(0); }',
      '.p { -webkit-filter: blur(2px); }',
      '.q { -ms-filter: "progid:DXImageTransform.Microsoft.Blur"; }',
      '.r { -webkit-backdrop-filter: saturate(180%); }',
      '.s { -webkit-perspective: 800px; }',
      '.t { -moz-perspective: 800px; }',

      // As mesmas em objeto JS. A capitalização segue a convenção do React-DOM
      // (`Webkit`/`Moz`/`O` com maiúscula, `ms` minúsculo — é assim que o React
      // aceita prefixo em `style`), e o parser as devolve em minúsculas.
      "const style = { WebkitTransform: 'translateZ(0)' };",
      "const style = { MozTransform: 'translateZ(0)' };",
      "const style = { msTransform: 'translateZ(0)' };",
      "const style = { OTransform: 'translateZ(0)' };",
      "const style = { WebkitFilter: 'blur(2px)' };",
      "const style = { msFilter: 'none' };",
      "const style = { WebkitBackdropFilter: 'saturate(180%)' };",
      "const style = { WebkitPerspective: '800px' };",
      "const style = { MozPerspective: '800px' };",
    ];
    for (const source of forbidden) {
      expect(
        declaredPropertyNames(source).filter((n) => FORBIDDEN_PROPERTIES.has(n)),
        source
      ).not.toEqual([]);
    }

    const allowed = [
      '.a { text-transform: uppercase; }',
      '.b { transition: opacity 150ms ease-out, transform 120ms ease-out; }',
      '@keyframes k { from { transform: scale(0.92); } to { transform: scale(1); } }',
      '/* transform é proibido aqui, e este comentário não pode se denunciar */',
      '// will-change também é proibido, idem',
      'const visible = items.filter((item) => item.ok);',
      'const label = cond ? "contain" : "other";',

      // Os quatro que a ampliação poderia ter comido, e é por isso que estão
      // aqui — cada um é um uso legítimo que passou a PARECER ofensor quando
      // `rotate`/`scale` entraram na lista:
      //  - `rotate` e `scale` como VALOR de `transition`/`animation` é o caso
      //    mais provável de todos (animar rotação é comum, e `transition:
      //    rotate` não cria containing block: quem cria é a propriedade
      //    declarada, que aqui é `transition`);
      '.c { transition: rotate 120ms ease-out; }',
      '.d { animation: rotate 2s linear infinite; }',
      //  - `transform-origin` é nome PRÓPRIO, não `transform` com sufixo, e não
      //    cria containing block nenhum — mesma absolvição de
      //    `text-transform: uppercase` acima;
      '.e { transform-origin: 50% 50%; }',
      //  - destruturação não tem `:`, então o nome nunca é extraído. Importa
      //    porque é a saída recomendada quando uma chave `scale` legítima
      //    precisar existir num arquivo da cadeia (ver o comentário da `Set`).
      'const { scale } = vv;',
    ];
    for (const source of allowed) {
      expect(
        declaredPropertyNames(source).filter((n) => FORBIDDEN_PROPERTIES.has(n)),
        source
      ).toEqual([]);
    }
  });

  // HTML é o único formato da lista que não é CSS nem JS, e as duas metades do
  // suporte a ele — varrer o `<style>` e descartar o `<!-- -->` — chegaram sem
  // NENHUMA prova permanente. Medido nesta passada de QA, não deduzido:
  //  - apagar a linha `.replace(/<!--[\s\S]*?-->/g, '\n')` de stripComments
  //    deixa a suíte inteira verde (10 passed), porque o `index.html` de hoje
  //    não tem nenhum comentário que dispare o falso positivo;
  //  - nenhuma declaração do `<style>` de hoje (`background: #0d0d0d`) está na
  //    `FORBIDDEN_PROPERTIES`, então a varredura do `<style>` também passaria
  //    verde se parasse de acontecer.
  // Ou seja: as duas provas de vermelho que justificaram o suporte a HTML só
  // existiram como injeção temporária no `index.html` e evaporaram com ela.
  //
  // O caso usa FIXTURE e não o arquivo real de propósito: o que está sob teste é
  // o comportamento do parser sobre HTML, que não pode depender de o
  // `index.html` continuar tendo um `<style>` e comentários com a forma certa.
  // A vigilância do arquivo real é o `it.each(CHAIN_SOURCES)` acima.
  it('reads declarations inside <style> and ignores them inside HTML comments', () => {
    const styleBlock = [
      '<!doctype html>',
      '<head>',
      '  <style>',
      '    html, body { transform: translateZ(0); }',
      '  </style>',
      '</head>',
    ].join('\n');

    // A metade POSITIVA: sem ela, a entrada `index.html` em CHAIN_SOURCES seria
    // vigilância de fachada — um `<style>` que estilize `html`/`body` (dois nós
    // da cadeia, estilizados antes de o React montar) passaria batido.
    expect(
      declaredPropertyNames(styleBlock).filter((n) => FORBIDDEN_PROPERTIES.has(n))
    ).toEqual(['transform']);

    // A metade NEGATIVA: comentário HTML MULTILINHA com a palavra proibida no
    // início de uma linha. É o formato exato dos dois comentários que o
    // `index.html` já tem hoje, e o arquivo é feito de prosa explicativa — a
    // primeira vez que alguém escrever "não declare transform: aqui" dentro de
    // um `<!-- -->`, o teste se autodenuncia e acusa um ofensor que não existe.
    // (Comentário de UMA linha escapa por outro caminho — o `<!--` gruda no nome
    // e o guard de caracteres rejeita o candidato — e por isso NÃO serve de
    // prova para esta regra.)
    const multilineComment = [
      '<!-- Milestone 1: o fundo escuro pré-JS mora no <style> abaixo.',
      '     transform: translateY(-offsetTop) seria a alternativa óbvia para',
      '     compensar o pan do Safari, e é PROIBIDA na cadeia de layout.',
      '     -->',
      '<style>html, body { background: #0d0d0d; }</style>',
    ].join('\n');

    expect(
      declaredPropertyNames(multilineComment).filter((n) => FORBIDDEN_PROPERTIES.has(n))
    ).toEqual([]);
  });
});
