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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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

// Cada entrada é um NOME de declaração (nunca um valor — ver
// declaredPropertyNames), e aparece em até duas grafias porque a cadeia v2 é
// estilizada tanto por CSS (`index.css`, `theme.css`, o `<style>` do
// `index.html`) quanto por objetos de estilo JS, onde a mesma propriedade vira
// camelCase e o parser a devolve em minúsculas: `backdrop-filter` e
// `backdropfilter` são a MESMA proibição escrita duas vezes, não duas
// propriedades. Não há lógica de prefixo nem de camelização aqui de propósito:
// derivar as variantes daria a impressão de completude que uma `Set` de literais
// não finge ter, e um literal a mais custa uma linha.
//
// FALSO POSITIVO CONHECIDO, e a saída correta quando ele acontecer: uma CHAVE DE
// OBJETO JS que se chame `scale`, `rotate`, `translate` ou `filter` num arquivo
// da cadeia é acusada, mesmo sem ser declaração de estilo — `{ scale: 1 }` e
// `{ filter: 'ativos' }` são indistinguíveis de uma declaração para um parser
// que só olha "nome antes dos dois-pontos". Essa classe NÃO é nova: já existia
// por causa de `filter` desde a primeira versão da lista; `translate`/`rotate`/
// `scale` só a alargam. Neste repo o risco é concreto e nomeável:
// `getVisibleViewport` (utils/fabGeometry.js) documenta `vv.scale !== 1` como
// ressalva deliberada e `src/test/fakeVisualViewport.js` já constrói o fake com
// `scale` — nenhum dos dois está na cadeia hoje, mas um deles pode entrar. A
// saída correta é RENOMEAR A CHAVE (ou destruturar, que não tem `:` e passa
// batido), NUNCA abrir exceção na lista: o custo de um rename é uma linha, o
// custo de uma exceção é um buraco permanente na única guarda automática que
// existe contra esse modo de falha.
//
// CRITÉRIO DAS PREFIXADAS (não é produto cartesiano de 4 vendors × 4
// propriedades — 18 literais dos 32 possíveis): entra a combinação que algum
// engine REALMENTE embarcou, porque é essa que aparece em snippet copiado de
// Stack Overflow e é essa que um autoprefixer emite. Ficam de fora as que nunca
// existiram, para a lista não passar por tabela de suporte de browser:
//  - `transform` nos 4 vendors — todos embarcaram (Safari/iOS, Firefox < 16,
//    IE 9, Opera Presto). É a de longe mais provável de reaparecer;
//  - `filter` em `-webkit-` (Safari/iOS 6-9, ainda emitida por autoprefixer) e
//    em `-ms-`. O `-ms-filter` é caso especial e entra de propósito: é OUTRA
//    coisa (o `progid:DXImageTransform` proprietário da IE), mas é um nome real,
//    é igualmente indesejado num nó da cadeia, e nada legítimo neste repo
//    (React 18 + Vite, alvo Safari de iPad) tem motivo para declará-lo;
//  - `backdrop-filter` só em `-webkit-` — o único prefixo que existiu, e o mais
//    provável de ser digitado AQUI, porque o Safari ainda exige a forma
//    prefixada para efeito de vidro;
//  - `perspective` em `-webkit-` e `-moz-` — 3D transforms prefixadas só
//    existiram nesses dois (IE 11 e Presto nunca tiveram `-ms-`/`-o-`).
const FORBIDDEN_PROPERTIES = new Set([
  // O núcleo original: as 4 propriedades que motivaram o teste a existir.
  'transform',
  'filter',
  'backdrop-filter',
  'backdropfilter',
  'will-change',
  'willchange',
  'contain',

  // Ampliação: mesmo efeito de containing block, nomes diferentes.
  //  - `perspective` (≠ `none`) cria containing block por si só, sem `transform`;
  //  - `content-visibility` (`auto`/`hidden`) IMPLICA contenção de paint, e
  //    contenção de paint é o que cria o containing block — o nome não parece
  //    ter nada a ver com posicionamento, e é justamente por isso que passaria;
  //  - `container-type` (≠ `normal`) implica contenção pelo mesmo caminho. É a
  //    mais perigosa das novas em termos de probabilidade: container queries são
  //    a resposta idiomática de 2025 para "este painel precisa reagir à própria
  //    largura", exatamente o problema que o terminal e o painel de atalhos têm;
  //  - `translate`/`rotate`/`scale` são as propriedades individuais de transform
  //    (CSS Transforms 2), atalho moderno para o que `transform` fazia — quem as
  //    usa está deliberadamente evitando escrever `transform` e escaparia da
  //    lista antiga por isso.
  'perspective',
  'content-visibility',
  'contentvisibility',
  'container-type',
  'containertype',
  'translate',
  'rotate',
  'scale',

  // Prefixadas — ver o CRITÉRIO acima. Sempre em par: grafia CSS hifenizada e
  // a mesma em camelCase de objeto JS, que o parser devolve em minúsculas
  // (`WebkitTransform` -> `webkittransform`, `msTransform` -> `mstransform`).
  '-webkit-transform',
  'webkittransform',
  '-moz-transform',
  'moztransform',
  '-ms-transform',
  'mstransform',
  '-o-transform',
  'otransform',
  '-webkit-filter',
  'webkitfilter',
  '-ms-filter',
  'msfilter',
  '-webkit-backdrop-filter',
  'webkitbackdropfilter',
  '-webkit-perspective',
  'webkitperspective',
  '-moz-perspective',
  'mozperspective',
]);

/**
 * Remove comentários de bloco, de linha e de HTML, para a prosa não se
 * autodenunciar.
 *
 * A regra `<!-- -->` entrou junto com `index.html` na lista acima, e contra o
 * `index.html` de HOJE ela é PREVENTIVA — dito assim, sem eufemismo, porque a
 * frase anterior deste parágrafo afirmava o contrário e um comentário que mente
 * é o defeito mais caro deste repo. Os dois comentários multilinha que o arquivo
 * tem hoje (o do manifest PWA e o do fundo pré-JS) não têm palavra proibida no
 * início de nenhuma linha, então apagar esta regra NÃO muda o veredito sobre
 * aquele arquivo.
 *
 * O que ela impede é o comentário seguinte: um `<!-- -->` multilinha com a
 * palavra no início de uma linha (`<!--\n  transform: nunca aqui\n-->`) derruba
 * o teste ACUSANDO UM OFENSOR QUE NÃO EXISTE. A probabilidade não é acadêmica —
 * `index.html` é feito de prosa explicativa, e o motivo de ele estar na lista é
 * ter estilo de dois nós da cadeia, exatamente o assunto sobre o qual alguém vai
 * escrever ali "não declare X aqui".
 *
 * Quem for medir a necessidade desta linha apagando-a: o vermelho vem do caso
 * `reads declarations inside <style> and ignores them inside HTML comments`, que
 * usa FIXTURE justamente para não depender de o arquivo real continuar tendo a
 * forma certa de comentário — e não do `it.each` sobre o `index.html`, que segue
 * verde. Isso é desenho, não lacuna.
 *
 * (Comentário HTML de UMA linha escapa por outro caminho, e por acidente: o
 * `<!--` gruda no nome e o guard de caracteres rejeita o candidato. É sorte, não
 * cobertura — não serve de prova para esta regra.)
 *
 * HTML primeiro, de propósito: o conteúdo de um `<!-- -->` sai inteiro antes das
 * regras de `/* *\/` e `//`, então nada dentro dele pode desbalancear as duas
 * seguintes.
 */
function stripComments(source) {
  return source
    .replace(/<!--[\s\S]*?-->/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '\n')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/([^:])\/\/.*$/gm, '$1');
}

/**
 * Remove blocos `@keyframes … { … }` inteiros (incluindo as chaves internas dos
 * passos). `transform` dentro de um keyframe é legítimo: ele nunca é uma
 * declaração aplicada a um nó da cadeia por si só.
 */
function stripKeyframes(source) {
  let out = '';
  let index = 0;
  for (;;) {
    const at = source.indexOf('@keyframes', index);
    if (at === -1) {
      out += source.slice(index);
      return out;
    }
    out += source.slice(index, at);
    const open = source.indexOf('{', at);
    if (open === -1) return out;
    let depth = 0;
    let cursor = open;
    for (; cursor < source.length; cursor += 1) {
      if (source[cursor] === '{') depth += 1;
      else if (source[cursor] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    index = cursor + 1;
  }
}

/**
 * Nomes de propriedade das declarações do arquivo.
 *
 * Serve CSS e objeto de estilo JS com o mesmo algoritmo: quebrar em `; , { } \n`
 * e, de cada pedaço, tomar o que vem antes do primeiro `:`. Um valor de
 * declaração nunca sobrevive a essa quebra como nome — em
 * `transition: opacity 150ms, transform 120ms` o pedaço ` transform 120ms` não
 * tem `:`, logo não é um nome de propriedade. E em `text-transform:` o nome
 * inteiro é `text-transform`, que não está na lista.
 */
function declaredPropertyNames(source) {
  const clean = stripKeyframes(stripComments(source));
  const names = [];
  for (const chunk of clean.split(/[;,{}\n]/)) {
    const colon = chunk.indexOf(':');
    if (colon === -1) continue;
    const name = chunk.slice(0, colon).trim().replace(/^['"]|['"]$/g, '');
    if (!name || /[\s()[\]=<>?!&|+*/]/.test(name)) continue;
    names.push(name.toLowerCase());
  }
  return names;
}

function readChainSource(relativePath) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

describe('fixed-positioning invariant on the layout chain', () => {
  it.each(CHAIN_SOURCES)(
    'declares no containing-block-creating property in %s',
    (relativePath) => {
      const offenders = declaredPropertyNames(readChainSource(relativePath))
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
