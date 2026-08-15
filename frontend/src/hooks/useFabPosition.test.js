// frontend/src/hooks/useFabPosition.test.js
//
// Este arquivo não existia. O hook que guarda ONDE o FAB de atalhos repousa —
// o que é lido do localStorage, o que é rejeitado, e o que acontece com a posição
// quando a viewport muda — chegou ao iPad do Bruno sem nenhum teste próprio, na
// mesma rodada em que um bug de duas linhas no arrasto passou pelo mesmo buraco.
//
// O TESTE QUE MAIS IMPORTA AQUI É `does not ratchet the position inward across
// repeated viewport changes`. A invariante está escrita no topo de
// useFabPosition.js e nomeia o refactor exato que a quebra (re-clampar o px
// ATUAL em vez de re-derivar da % persistida), com um sintoma já observado em
// campo: 3 rotações e o FAB migrou ~40px do canto. Uma invariante documentada só
// em comentário é uma invariante que o próximo refactor apaga.
//
// AMBIENTE (jsdom 29.1.1, verificado, não herdado de documento):
//  - `window.innerWidth/innerHeight` = 1024x768;
//  - `window.visualViewport` NÃO existe -> getVisibleViewport cai no fallback de
//    innerWidth/innerHeight, então as bounds de um FAB de 44px (o default do
//    hook) são { minLeft: 12, maxLeft: 968, minTop: 12, maxTop: 712 };
//  - `env()` não é resolvido -> insets todos 0;
//  - `localStorage` é REAL (Node 26 + o guard de `execArgv` em vite.config.js),
//    compartilhado entre os testes do arquivo, e por isso a chave é limpa no
//    beforeEach E no afterEach: um teste que falhe no meio deixaria o blob para o
//    próximo, e o próximo passaria (ou falharia) pelo motivo errado.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { installFakeVisualViewport } from '../test/fakeVisualViewport.js';
import { FAB_POSITION_STORAGE_KEY, useFabPosition } from './useFabPosition.js';

// Bounds de um FAB de 44px neste ambiente. Literais: ver o cabeçalho de
// utils/fabGeometry.test.js sobre por que não se constroem com a própria função.
const DEFAULT_LEFT_PX = 968;
const DEFAULT_TOP_PX = 712;

const storeBlob = (value) => localStorage.setItem(FAB_POSITION_STORAGE_KEY, value);
const readBlob = () => {
  const raw = localStorage.getItem(FAB_POSITION_STORAGE_KEY);
  return raw === null ? null : JSON.parse(raw);
};

describe('useFabPosition — stored position', () => {
  beforeEach(() => {
    localStorage.removeItem(FAB_POSITION_STORAGE_KEY);
  });

  afterEach(() => {
    cleanup();
    localStorage.removeItem(FAB_POSITION_STORAGE_KEY);
    vi.restoreAllMocks();
  });

  it('rests in the bottom-right corner when nothing was ever stored', () => {
    const { result } = renderHook(() => useFabPosition());

    expect(result.current.position).toEqual({
      left: DEFAULT_LEFT_PX, top: DEFAULT_TOP_PX,
    });
  });

  it('restores a stored percentage as pixels of the current placeable range', () => {
    // 0.5 / 0.25 de um range de 956x700, deslocado pelos 12px de margem:
    // 12 + 478 = 490, e 12 + 175 = 187. Números literais, não a fórmula.
    storeBlob(JSON.stringify({ v: 1, xPercent: 0.5, yPercent: 0.25 }));

    const { result } = renderHook(() => useFabPosition());

    expect(result.current.position.left).toBeCloseTo(490, 9);
    expect(result.current.position.top).toBeCloseTo(187, 9);
  });

  it('scales a stored percentage to the rendered size that is passed in', () => {
    // Mesmo blob, FAB de 56px: o range encurta 12px em cada eixo
    // (maxLeft 956, maxTop 700), então a MESMA % vira um px diferente. Isto é
    // comportamento correto ("o canto continua canto") e não uma coincidência —
    // o teste existe porque `size` chega ao hook por parâmetro e um refactor que
    // o ignorasse deixaria os bounds em 44 sem sintoma além de um FAB parando
    // 12px antes da borda.
    storeBlob(JSON.stringify({ v: 1, xPercent: 1, yPercent: 1 }));

    const { result } = renderHook(() => useFabPosition({ size: 56 }));

    expect(result.current.position).toEqual({ left: 956, top: 700 });
  });

  // Os shapes que `readStoredPercent` tem que rejeitar. Cada um é um jeito real
  // de o blob chegar corrompido: escrita interrompida, versão antiga do schema,
  // outra feature usando a mesma chave, ou um valor que passou por
  // `JSON.stringify` de um objeto onde o número virou string. Todos caem no canto
  // padrão, que é o único fallback que o usuário reconhece.
  //
  // Os dois últimos merecem nota, porque são os que um refactor quebra sem
  // perceber: `'0.5'` e `null` são reprovados EXCLUSIVAMENTE por
  // `Number.isFinite`. Trocá-lo por uma checagem "solta" — `typeof x !== 'number'`
  // deixaria `NaN` passar; `x >= 0 && x <= 1` deixaria `'0.5'` passar por coerção
  // e `null` passar como 0 — e o resultado seria `left: NaNpx` (declaração
  // descartada pelo browser, FAB no canto superior esquerdo do fluxo) ou um FAB
  // silenciosamente teleportado para o canto oposto. Nenhum dos dois se parece
  // com "posição corrompida" na tela.
  const INVALID_BLOBS = [
    ['is not valid json', 'not json at all{'],
    ['carries no schema version', '{}'],
    ['carries a different schema version', JSON.stringify({ v: 2, xPercent: 0.5, yPercent: 0.5 })],
    ['carries a percentage as a string', JSON.stringify({ v: 1, xPercent: '0.5', yPercent: 0.5 })],
    ['carries a percentage outside [0, 1]', JSON.stringify({ v: 1, xPercent: 1.5, yPercent: 0.5 })],
    // `null` sobrevive ao JSON.stringify de um objeto cujo campo foi zerado por
    // uma escrita interrompida, e é o caso em que `x >= 0 && x <= 1` daria
    // `true` (null coage para 0) — ou seja, o FAB apareceria encostado no canto
    // SUPERIOR ESQUERDO em vez de no canto que o usuário deixou.
    ['carries a null percentage', JSON.stringify({ v: 1, xPercent: null, yPercent: 0.5 })],
  ];

  for (const [description, blob] of INVALID_BLOBS) {
    it(`falls back to the default corner when the stored blob ${description}`, () => {
      storeBlob(blob);

      const { result } = renderHook(() => useFabPosition());

      expect(result.current.position).toEqual({
        left: DEFAULT_LEFT_PX, top: DEFAULT_TOP_PX,
      });
    });
  }

  it('falls back to the default corner when localStorage throws on read', () => {
    // Safari em modo privado lança já na LEITURA, não só na escrita — e o modo
    // privado do iPad é um cenário real do Bruno. Sem o try/catch o hook estoura
    // no primeiro render e o FAB (junto com o ChatV2 inteiro) não monta.
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError: localStorage is not available');
    });

    let result;
    expect(() => {
      ({ result } = renderHook(() => useFabPosition()));
    }).not.toThrow();

    expect(result.current.position).toEqual({
      left: DEFAULT_LEFT_PX, top: DEFAULT_TOP_PX,
    });
  });

  it('still moves the fab when localStorage throws on write', () => {
    // O commit tem DUAS responsabilidades: mover agora e lembrar depois. Se a
    // segunda falhar, a primeira não pode falhar com ela — um arrasto que não
    // move porque o storage está cheio seria indistinguível, para o usuário, do
    // bug original ("arrasto e o botão volta").
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    const { result } = renderHook(() => useFabPosition());
    let committed;
    act(() => {
      committed = result.current.commitPosition({ left: 400, top: 300 });
    });

    expect(committed).toEqual({ left: 400, top: 300 });
    expect(result.current.position).toEqual({ left: 400, top: 300 });
  });
});

describe('useFabPosition — commit', () => {
  beforeEach(() => {
    localStorage.removeItem(FAB_POSITION_STORAGE_KEY);
  });

  afterEach(() => {
    cleanup();
    localStorage.removeItem(FAB_POSITION_STORAGE_KEY);
    vi.restoreAllMocks();
  });

  it('persists the committed position as a fraction of the placeable range', () => {
    const { result } = renderHook(() => useFabPosition());

    act(() => {
      result.current.commitPosition({ left: 500, top: 362 });
    });

    const stored = readBlob();
    expect(stored.v).toBe(1);
    // (500-12)/956 e (362-12)/700 = 0.5 exato no eixo Y.
    expect(stored.xPercent).toBeCloseTo(488 / 956, 12);
    expect(stored.yPercent).toBeCloseTo(0.5, 12);
  });

  it('clamps and snaps before persisting, and returns the final pixels synchronously', () => {
    // O retorno síncrono não é conveniência: TerminalShortcutsFab escreve
    // `left`/`top` no DOM dentro do MESMO handler de pointerup, porque esperar o
    // próximo render do React produziria um frame com o FAB na posição antiga —
    // o "salta pra trás e volta" de ~16ms, visível no iPad e invisível em teste.
    const { result } = renderHook(() => useFabPosition());

    let committed;
    act(() => {
      // Muito fora da tela em X (clamp para 968) e a 12px do bound inferior em Y
      // (dentro dos 24px de snap, portanto gruda em 712).
      committed = result.current.commitPosition({ left: 5000, top: 700 });
    });

    expect(committed).toEqual({ left: DEFAULT_LEFT_PX, top: DEFAULT_TOP_PX });
    expect(result.current.position).toEqual({
      left: DEFAULT_LEFT_PX, top: DEFAULT_TOP_PX,
    });
    // Grudou nos dois bounds máximos, então a % é 1 nos dois eixos — e é ESSA %
    // que faz o canto continuar canto depois de uma rotação.
    expect(readBlob()).toEqual({ v: 1, xPercent: 1, yPercent: 1 });
  });
});

describe('useFabPosition — viewport resync', () => {
  let restoreViewport;
  let vv;

  const installViewport = (init) => {
    const installed = installFakeVisualViewport(init);
    vv = installed.vv;
    restoreViewport = installed.restore;
    return installed.vv;
  };

  const resize = (patch) => {
    vv.set(patch);
    act(() => { vv.fire('resize'); });
  };

  beforeEach(() => {
    localStorage.removeItem(FAB_POSITION_STORAGE_KEY);
  });

  afterEach(() => {
    cleanup();
    if (restoreViewport) restoreViewport();
    restoreViewport = undefined;
    vv = undefined;
    localStorage.removeItem(FAB_POSITION_STORAGE_KEY);
    vi.restoreAllMocks();
  });

  it('does not ratchet the position inward across repeated viewport changes', () => {
    // A INVARIANTE CRÍTICA DO HOOK, e o único teste da suíte que a guarda.
    //
    // A fonte de verdade é a PORCENTAGEM: cada mudança de viewport re-deriva o px
    // a partir dela. O refactor "óbvio" — re-clampar o px ATUAL contra as bounds
    // novas — parece equivalente e não é: o clamp é uma projeção, então cada
    // rotação para uma tela mais estreita EMPURRA a posição para dentro e a
    // rotação de volta não a traz. É monotônico, e foi observado em campo (3
    // rotações, ~40px de migração para dentro do canto).
    //
    // Números: FAB em (900, 600) numa paisagem de 1024x768 (range 956x700).
    // Em retrato 768x1024 o range é 700x956 e o px re-derivado é ~662/~815 —
    // dentro das bounds, então o clamp não teria nada a fazer NAQUELE sentido.
    // O que o refactor quebrado faria é clampar 900 contra maxLeft = 712 e
    // devolver 712, perdendo 188px de uma vez, para sempre.
    installViewport({ width: 1024, height: 768 });
    const { result } = renderHook(() => useFabPosition());

    act(() => { result.current.commitPosition({ left: 900, top: 600 }); });
    expect(result.current.position).toEqual({ left: 900, top: 600 });

    for (let rotation = 0; rotation < 3; rotation += 1) {
      resize({ width: 768, height: 1024 });
      // Passagem pelo retrato: a posição re-derivada tem que ser a MESMA fração
      // do range novo, não o px antigo aparado.
      // x: 12 + (888/956)*700 = 662.2092...   y: 12 + (588/700)*956 = 815.04
      expect(result.current.position.left).toBeCloseTo(662.2092050209, 6);
      expect(result.current.position.top).toBeCloseTo(815.04, 6);

      resize({ width: 1024, height: 768 });
      // E o retorno é exato, rotação após rotação. Com o refactor quebrado este
      // valor seria 712 já na primeira volta e nunca mais mudaria.
      expect(result.current.position.left).toBeCloseTo(900, 6);
      expect(result.current.position.top).toBeCloseTo(600, 6);
    }
  });

  it('re-anchors the fab against a panned visual viewport', () => {
    // O teclado do iPad não só encolhe a visual viewport: com `overflow: hidden`
    // na página o Safari PANEIA a layout viewport, e `position: fixed` resolve
    // contra a layout. Um FAB que ignorasse `offsetTop` ficaria literalmente
    // debaixo do teclado. Aqui: origem em (0, 120) e altura 500 -> maxTop =
    // 120 + 500 - 12 - 44 = 564.
    installViewport({ width: 1024, height: 768 });
    const { result } = renderHook(() => useFabPosition());
    expect(result.current.position.top).toBe(DEFAULT_TOP_PX);

    vv.set({ height: 500, offsetTop: 120 });
    act(() => { vv.fire('scroll'); }); // é o `scroll` que reporta o pan

    expect(result.current.position).toEqual({ left: DEFAULT_LEFT_PX, top: 564 });
    expect(result.current.viewport).toEqual({
      left: 0, top: 120, width: 1024, height: 500,
    });
  });

  it('recomputes the default corner on a viewport change when nothing was ever stored', () => {
    // Sem % salva o default é a REGRA "canto inferior direito", não um px
    // congelado no mount. Se o hook guardasse o px do primeiro measure, um usuário
    // que nunca arrastou nada veria o FAB flutuando no meio da tela depois de
    // girar o iPad.
    installViewport({ width: 1024, height: 768 });
    const { result } = renderHook(() => useFabPosition());
    expect(result.current.position).toEqual({ left: 968, top: 712 });

    resize({ width: 768, height: 1024 });

    expect(result.current.position).toEqual({ left: 712, top: 968 });
    expect(readBlob()).toBeNull(); // e nada foi persistido no caminho
  });

  it('reacts to scroll as well as resize, because iOS reports the keyboard as either', () => {
    // Não é redundância defensiva: versões diferentes do iOS reportam o mesmo
    // evento físico (o teclado subindo) como `resize` OU como `scroll` da visual
    // viewport. Escutar um só deixa metade dos iPadOS sem correção — e é
    // impossível saber qual metade a partir daqui.
    installViewport({ width: 1024, height: 768 });
    const { result } = renderHook(() => useFabPosition());

    vv.set({ height: 500 });
    act(() => { vv.fire('scroll'); });
    expect(result.current.position.top).toBe(444); // 500 - 12 - 44

    vv.set({ height: 768 });
    act(() => { vv.fire('resize'); });
    expect(result.current.position.top).toBe(DEFAULT_TOP_PX);
  });

  it('suspends the resync while a gesture is in progress and resumes after it', () => {
    // `suspendResyncRef` é o par obrigatório da correção do arrasto: a base do
    // gesto (startLeft/startTop) é capturada uma vez no pointerdown, e um resync
    // no meio do caminho a trocaria embaixo do dedo. Um ref setado e nunca limpo
    // seria um bug PIOR que o original — o FAB ficaria permanentemente surdo a
    // rotação e teclado — então as duas metades são asseveradas no mesmo teste.
    installViewport({ width: 1024, height: 768 });
    const { result } = renderHook(() => useFabPosition());

    result.current.suspendResyncRef.current = true;
    resize({ height: 500 });
    expect(result.current.position.top).toBe(DEFAULT_TOP_PX); // congelado

    result.current.suspendResyncRef.current = false;
    resize({ height: 500 }); // mesmo retângulo, agora observado
    expect(result.current.position.top).toBe(444);
  });

  it('reamples the viewport inside commitPosition even while the resync is suspended', () => {
    // Consequência necessária da suspensão: se o commit também herdasse a
    // viewport congelada, um arrasto terminado depois de o teclado abrir
    // persistiria uma % medida contra bounds que já não existem. `commitPosition`
    // chama `measure()` por conta própria justamente por isso.
    installViewport({ width: 1024, height: 768 });
    const { result } = renderHook(() => useFabPosition());

    result.current.suspendResyncRef.current = true;
    resize({ height: 500 }); // ignorado pelo resync
    expect(result.current.position.top).toBe(DEFAULT_TOP_PX);

    act(() => { result.current.commitPosition({ left: 500, top: 600 }); });

    // maxTop já é 444 na viewport encolhida: 600 é clampado para lá, e 444
    // encosta no bound, então o snap o mantém. yPercent = 1.
    expect(result.current.position).toEqual({ left: 500, top: 444 });
    expect(readBlob().yPercent).toBe(1);
  });

  it('removes its viewport listeners on unmount', () => {
    // Um listener vazado sobrevive ao componente e chama setState num hook
    // desmontado a cada evento de teclado — warning de act na suíte, e no
    // dispositivo um vazamento que cresce a cada troca de sessão.
    installViewport({ width: 1024, height: 768 });
    const view = renderHook(() => useFabPosition());
    expect(vv.listenerCount('resize')).toBe(1);
    expect(vv.listenerCount('scroll')).toBe(1);

    view.unmount();

    expect(vv.listenerCount('resize')).toBe(0);
    expect(vv.listenerCount('scroll')).toBe(0);
  });

  it('works with no visualViewport at all, falling back to the layout viewport', () => {
    // Estado natural do jsdom, e de um browser antigo: os listeners de `window`
    // (`resize`/`orientationchange`) são o único caminho de resync que resta.
    expect(window.visualViewport).toBeUndefined();

    const { result } = renderHook(() => useFabPosition());
    expect(result.current.position).toEqual({
      left: DEFAULT_LEFT_PX, top: DEFAULT_TOP_PX,
    });

    const originalWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { value: 768, configurable: true });
    try {
      act(() => { window.dispatchEvent(new Event('orientationchange')); });
      expect(result.current.position.left).toBe(712); // 768 - 12 - 44
    } finally {
      Object.defineProperty(window, 'innerWidth', {
        value: originalWidth, configurable: true,
      });
    }
  });
});

// Viewport DEGENERADA: a visual viewport reportada menor que o próprio FAB mais
// as duas margens de borda. Terreno que este arquivo não cobria em nenhum dos
// seus outros testes, e o único em que `pxToPercent` devolve um valor que não
// descreve a posição do FAB — `pct1` (utils/fabGeometry.js) devolve `1` para
// QUALQUER posição quando o range não existe, porque precisa devolver um número.
//
// O que está sob teste aqui não é a aritmética (isso é de fabGeometry.test.js) e
// sim a decisão de `commitPosition` de NÃO gravar essa % arbitrária. Sem o guard,
// o `1` sobrevive ao reload, é relido com bounds saudáveis e o FAB reaparece no
// canto oposto ao que o usuário deixou.
//
// Nota de alcançabilidade, para ninguém tratar isto como reprodução de bug de
// campo: a precondição (`vv.width`/`vv.height` < 68px) não acontece em
// dispositivo real — o pior caso touch é ~175px e o iPad com teclado é >= 455px.
// Estes dois testes existem porque a ÚNICA barreira contra o modo de falha é uma
// condição de duas comparações que um refactor apaga sem sintoma nenhum.
describe('useFabPosition — degenerate viewport', () => {
  let restoreViewport;

  // 40x40: `maxLeft = 40 - 12 - 44 = -16` contra `minLeft = 12`, e idem no eixo
  // Y. Os dois eixos degenerados de uma vez, que é a forma mais simples de
  // satisfazer o guard de eixo cruzado do hook.
  const installDegenerateViewport = () => {
    const installed = installFakeVisualViewport({ width: 40, height: 40 });
    restoreViewport = installed.restore;
    return installed.vv;
  };

  // Versão parametrizada, para os casos de UM eixo só e os de borda exata do
  // range. Mesma mecânica de restore.
  const installViewport = (init) => {
    const installed = installFakeVisualViewport(init);
    restoreViewport = installed.restore;
    return installed.vv;
  };

  beforeEach(() => {
    localStorage.removeItem(FAB_POSITION_STORAGE_KEY);
  });

  afterEach(() => {
    cleanup();
    if (restoreViewport) restoreViewport();
    restoreViewport = undefined;
    localStorage.removeItem(FAB_POSITION_STORAGE_KEY);
    vi.restoreAllMocks();
  });

  it('does not persist a percentage measured against a degenerate range', () => {
    installDegenerateViewport();
    const { result } = renderHook(() => useFabPosition());

    let committed;
    act(() => {
      committed = result.current.commitPosition({ left: 500, top: 300 });
    });

    // A metade "mover" do commit continua inteira: clamp e snap colapsam nos
    // mínimos, o canto seguro. O guard suprime a persistência, não o movimento —
    // se algum dia suprimir o movimento também, o FAB fica preso durante um
    // arrasto e o sintoma é indistinguível do bug original ("arrasto e volta").
    expect(committed).toEqual({ left: 12, top: 12 });
    expect(result.current.position).toEqual({ left: 12, top: 12 });

    // E a metade "lembrar" não acontece: o storage continua VAZIO, então o
    // próximo mount cai no canto padrão em vez de num canto inventado.
    expect(localStorage.getItem(FAB_POSITION_STORAGE_KEY)).toBeNull();
  });

  it('leaves an already stored percentage untouched when the range is degenerate', () => {
    // O caso mais grave dos dois, e o que o teste anterior não pega: aqui existe
    // uma % BOA, gravada num momento em que a viewport era saudável. Sem o guard,
    // um único commit medido contra o range degenerado a sobrescreve por (1, 1)
    // — ou seja, a medição transitória não só deixa de informar, ela DESTRÓI a
    // posição que o usuário havia escolhido, de forma permanente.
    storeBlob(JSON.stringify({ v: 1, xPercent: 0.25, yPercent: 0.75 }));
    installDegenerateViewport();
    const { result } = renderHook(() => useFabPosition());

    act(() => { result.current.commitPosition({ left: 500, top: 300 }); });

    expect(readBlob()).toEqual({ v: 1, xPercent: 0.25, yPercent: 0.75 });
  });

  // ---------------------------------------------------------------------------
  // Degenerescência em UM eixo só.
  //
  // Os dois testes acima degeneram os DOIS eixos ao mesmo tempo, e por isso não
  // conseguem distinguir `&&` de `||` no guard: com os dois lados falsos,
  // qualquer um dos dois operadores suprime a persistência. Trocar o `&&` por
  // `||` — o "conserto" mais provável que alguém tentaria, com o argumento
  // razoável de "por que jogar fora o eixo que está bom?" — passaria os dois
  // testes existentes intacto.
  //
  // É exatamente essa mutação que os dois testes abaixo pegam, um por eixo. E o
  // que eles travam não é um detalhe de implementação: a % é um PAR sob um único
  // `v: 1` no blob, então gravar metade confiável e metade arbitrária produz um
  // blob que `readStoredPercent` ACEITA como válido — pior que blob nenhum,
  // porque nenhum fallback dispara e o FAB reaparece com um eixo teleportado.
  // O racional está escrito em useFabPosition.js; aqui ele vira executável.
  // ---------------------------------------------------------------------------

  it('discards the healthy axis too when only the x axis is degenerate', () => {
    // 40x768: `maxLeft = 40 - 12 - 44 = -16` (degenerado) contra `maxTop = 768 -
    // 12 - 44 = 712` (saudável, range de 700px).
    installViewport({ width: 40, height: 768 });
    const { result } = renderHook(() => useFabPosition());

    let committed;
    act(() => {
      committed = result.current.commitPosition({ left: 500, top: 300 });
    });

    // O eixo Y é medido normalmente e o movimento acontece nos dois: X colapsa
    // no canto seguro, Y fica onde foi solto.
    expect(committed).toEqual({ left: 12, top: 300 });

    // E mesmo assim NADA é persistido — nem o `yPercent` de 288/700, que seria
    // um valor perfeitamente bom. É a decisão de eixo cruzado.
    expect(localStorage.getItem(FAB_POSITION_STORAGE_KEY)).toBeNull();
  });

  it('discards the healthy axis too when only the y axis is degenerate', () => {
    // O espelho do anterior: 1024x40 dá `maxLeft = 968` (saudável) e
    // `maxTop = -16` (degenerado). Os dois existem porque um guard escrito com
    // um só dos dois operandos (`bounds.maxLeft > bounds.minLeft` sozinho, um
    // erro de copiar-colar plausível) passaria em UM deles e falharia no outro.
    installViewport({ width: 1024, height: 40 });
    const { result } = renderHook(() => useFabPosition());

    let committed;
    act(() => {
      committed = result.current.commitPosition({ left: 500, top: 300 });
    });

    expect(committed).toEqual({ left: 500, top: 12 });
    expect(localStorage.getItem(FAB_POSITION_STORAGE_KEY)).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // A borda exata do guard: `>` e não `>=`.
  //
  // O par abaixo fixa a fronteira num pixel. Sem ele, `>=` é indistinguível de
  // `>` na suíte inteira — e `>=` deixaria passar justamente o caso `span === 0`,
  // em que `pct1` devolve o `1` arbitrário do mesmo jeito que no caso `span < 0`.
  // ---------------------------------------------------------------------------

  it('does not persist when the placeable range is exactly zero', () => {
    // 68 = EDGE_MARGIN_PX * 2 + FAB_SIZE_PX. `maxLeft = 68 - 12 - 44 = 12`, que
    // é EXATAMENTE `minLeft`: o FAB cabe, mas não tem para onde ir. `pct1` vê
    // `span <= 0` e devolve o `1` arbitrário, então este caso precisa ser
    // suprimido junto com os de span negativo.
    installViewport({ width: 68, height: 68 });
    const { result } = renderHook(() => useFabPosition());

    act(() => { result.current.commitPosition({ left: 500, top: 300 }); });

    expect(result.current.position).toEqual({ left: 12, top: 12 });
    expect(localStorage.getItem(FAB_POSITION_STORAGE_KEY)).toBeNull();
  });

  it('persists again as soon as the range is one pixel wide', () => {
    // 69x69: `maxLeft = 13` contra `minLeft = 12`. Um pixel de range é range, e
    // `pct1` volta a devolver um valor que DESCREVE a posição. Este é o lado
    // positivo da fronteira, e sem ele um guard quebrado para "nunca persiste em
    // viewport pequena" passaria despercebido.
    installViewport({ width: 69, height: 69 });
    const { result } = renderHook(() => useFabPosition());

    act(() => { result.current.commitPosition({ left: 500, top: 300 }); });

    // Clampa em 13 e o snap o traz de volta para 12 (está a 1px do mínimo,
    // dentro dos 24px de SNAP_THRESHOLD_PX), então a % é 0 nos dois eixos —
    // um valor MEDIDO, não o `1` arbitrário do caminho degenerado.
    expect(result.current.position).toEqual({ left: 12, top: 12 });
    expect(readBlob()).toEqual({ v: 1, xPercent: 0, yPercent: 0 });
  });

  // ---------------------------------------------------------------------------
  // CARACTERIZAÇÃO do limite que a correção mínima deixou ABERTO de propósito.
  //
  // Este teste NÃO descreve um comportamento desejável: ele fixa, em código
  // executável, a fronteira exata da decisão do Bruno de guardar só o
  // `writeStoredPercent` e não a escrita em `percentRef.current`. O comentário
  // de useFabPosition.js já diz isso em prosa; prosa não fica vermelha.
  //
  // Por que vale existir mesmo descrevendo um teleporte: as duas metades que ele
  // assevera se movem em direções OPOSTAS. Se alguém fechar o caminho aberto
  // (guardar o ref também), a primeira asserção fica vermelha e a mudança é
  // deliberada, com este comentário na frente — que é todo o objetivo. Se
  // alguém afrouxar o guard do storage, a SEGUNDA fica vermelha e isso é
  // regressão pura. Um teste que só assevera o teleporte seria uma armadilha;
  // este assevera o teleporte E o que o impede de virar permanente.
  // ---------------------------------------------------------------------------

  it('teleports once on in-session viewport recovery but keeps the stored position intact', () => {
    const vv = installViewport({ width: 1024, height: 768 });
    const { result } = renderHook(() => useFabPosition());

    // O usuário deixa o FAB em (900, 600) com a viewport saudável.
    act(() => { result.current.commitPosition({ left: 900, top: 600 }); });
    expect(result.current.position).toEqual({ left: 900, top: 600 });
    expect(readBlob().xPercent).toBeCloseTo(888 / 956, 12);
    expect(readBlob().yPercent).toBeCloseTo(0.84, 12);

    // Uma medição transitória degenerada chega e um commit acontece embaixo
    // dela. `percentRef.current` recebe o `(1, 1)` arbitrário — NÃO guardado.
    vv.set({ width: 40, height: 40 });
    act(() => { vv.fire('resize'); });
    act(() => { result.current.commitPosition({ left: 12, top: 12 }); });

    // A viewport se recupera SEM remount: o resync re-deriva a posição a partir
    // do ref envenenado e o FAB salta para o canto inferior direito, a 68px de
    // onde o usuário o deixou no eixo X e a 112px no eixo Y.
    vv.set({ width: 1024, height: 768 });
    act(() => { vv.fire('resize'); });
    expect(result.current.position).toEqual({ left: 968, top: 712 });

    // Mas o storage nunca foi tocado: um reload (ou qualquer remount) devolve a
    // posição real do usuário. É ESTA asserção que a correção mínima comprou, e
    // é o que separa "o FAB pula uma vez nesta sessão" de "o usuário perdeu a
    // posição para sempre".
    expect(readBlob().xPercent).toBeCloseTo(888 / 956, 12);
    expect(readBlob().yPercent).toBeCloseTo(0.84, 12);
  });
});
