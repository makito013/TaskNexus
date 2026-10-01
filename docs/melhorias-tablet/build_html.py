#!/usr/bin/env python3
"""Gera as versões HTML da documentação a partir dos .md desta pasta.

Saídas:
  - um .html por parte (CONTEXTO, 00-…html a 06-…html) + index.html (do README.md),
    com as imagens referenciadas em img/ (relativas);
  - documentacao-completa.html: todas as partes numa página só, com as
    imagens embutidas em data URI (abre offline e no iPad sem depender da pasta);
  - documentacao-completa.md: todas as partes num único Markdown (para entregar a um agente).

Uso:  pip install markdown pygments pymdown-extensions && python3 docs/melhorias-tablet/build_html.py
"""
from __future__ import annotations

import base64
import html
import os
import re

import markdown
from markdown.extensions.toc import slugify_unicode

HERE = os.path.dirname(os.path.abspath(__file__))
NUMBERED = None  # preenchido abaixo de PARTS


def eyebrow(num: str) -> str:
    if not num.isdigit():
        return "Contexto para retomar o trabalho"
    return f"Parte {num} de {NUMBERED}"

PARTS = [
    ("CONTEXTO-PARA-AGENTE", "C", "Contexto para o agente"),
    ("00-visao-geral-e-diagnostico", "0", "Visão geral e diagnóstico"),
    ("01-visualizador-de-arquivos", "1", "Visualizador de arquivos"),
    ("02-chat-conversacional", "2", "Chat conversacional"),
    ("03-layout-amigavel", "3", "Layout amigável"),
    ("04-melhorias-adicionais", "4", "Melhorias adicionais"),
    ("05-plano-de-execucao-e-prompts", "5", "Plano e prompts"),
    ("06-planejamento-fase-v", "6", "Planejamento da Fase V"),
    ("07-planejamento-artefatos", "7", "Planejamento da Fase A"),
    ("08-planejamento-navegacao-cliente-projeto", "8", "Planejamento da Fase N"),
]
SITE_TITLE = "TaskNexus no Tablet"
NUMBERED = max(int(n) for _, n, _ in PARTS if n.isdigit())

CSS = r"""
:root{
  --bg:#f7f5f0; --surface:#fdfcf9; --surface-2:#efece5; --border:#e2ddd3;
  --text:#3b3530; --dim:#6b645c; --faint:#8a8378;
  --accent:#3f8f7c; --accent-strong:#2f7564; --accent-soft:#e3f1ec;
  --accent-2:#4b5fb0; --warn-soft:#fbf3e1; --warn:#c9962d;
  --code-bg:#25272d; --code-fg:#e6e3dd; --code-head:#31343b;
  --shadow:0 1px 2px rgba(60,50,40,.06),0 6px 20px rgba(60,50,40,.06);
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    color-scheme:dark;
    --bg:#1f2227; --surface:#262a31; --surface-2:#2f343c; --border:#3b414b;
    --text:#e7e8ec; --dim:#b2b6bf; --faint:#8f94a0;
    --accent:#7cc6b1; --accent-strong:#9ad8c6; --accent-soft:#233a35;
    --accent-2:#a3b1ea; --warn-soft:#3a3222; --warn:#e0b85a;
    --code-bg:#17191d; --code-fg:#e6e3dd; --code-head:#22252b;
    --shadow:none;
  }
}
:root[data-theme="dark"]{
  color-scheme:dark;
  --bg:#1f2227; --surface:#262a31; --surface-2:#2f343c; --border:#3b414b;
  --text:#e7e8ec; --dim:#b2b6bf; --faint:#8f94a0;
  --accent:#7cc6b1; --accent-strong:#9ad8c6; --accent-soft:#233a35;
  --accent-2:#a3b1ea; --warn-soft:#3a3222; --warn:#e0b85a;
  --code-bg:#17191d; --code-fg:#e6e3dd; --code-head:#22252b;
  --shadow:none;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}
@media (prefers-reduced-motion: reduce){html{scroll-behavior:auto}}
body{margin:0;background:var(--bg);color:var(--text);
  font-family:Figtree,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:16px;line-height:1.6}
a{color:var(--accent-2)}
a:focus-visible,button:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}
code,pre,kbd{font-family:"IBM Plex Mono",ui-monospace,Menlo,Consolas,monospace}

.shell{display:grid;grid-template-columns:280px minmax(0,1fr);max-width:1320px;margin:0 auto;
  padding-inline:24px;gap:40px}
.side{position:sticky;top:env(safe-area-inset-top,0px);align-self:start;max-height:100vh;overflow:auto;
  padding-block:28px 40px}
.brand{display:flex;align-items:center;gap:10px;text-decoration:none;color:var(--text);margin-bottom:22px}
.brand-mark{width:34px;height:34px;border-radius:10px;background:var(--accent);display:grid;place-items:center;
  color:#fff;font-weight:700;font-size:14px}
.brand b{display:block;font-size:15px;line-height:1.2}
.brand-text>span{display:block;font-size:12px;color:var(--faint)}
.parts{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}
.parts a{display:flex;gap:10px;align-items:baseline;padding:8px 10px;border-radius:10px;text-decoration:none;
  color:var(--dim);font-size:14px;line-height:1.3}
.parts a .n{font-family:"IBM Plex Mono",monospace;font-size:12px;color:var(--faint);min-width:14px}
.parts a:hover{background:var(--surface-2);color:var(--text)}
.parts a.on{background:var(--accent-soft);color:var(--accent-strong);font-weight:600}
.parts a.on .n{color:var(--accent-strong)}
.toc{margin-top:18px;padding-top:14px;border-top:1px solid var(--border)}
.toc-title{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--faint);
  margin:0 0 8px 10px}
.toc ul{list-style:none;margin:0;padding:0}
.toc a{display:block;padding:4px 10px;font-size:13px;color:var(--dim);text-decoration:none;line-height:1.35;
  border-radius:8px}
.toc a:hover{color:var(--text);background:var(--surface-2)}
.toc ul ul a{padding-left:22px;font-size:12.5px;color:var(--faint)}
.theme-btn{margin-top:18px;margin-left:10px;font:inherit;font-size:12.5px;color:var(--dim);background:none;
  border:1px solid var(--border);border-radius:8px;padding:6px 10px;cursor:pointer;min-height:36px}

main{padding-block:28px 96px;min-width:0;overflow-x:clip}
.doc{max-width:80ch}
.eyebrow{font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--accent-strong);
  margin:0 0 6px}
.doc h1{font-size:clamp(26px,3.4vw,34px);line-height:1.2;margin:0 0 18px;text-wrap:balance;letter-spacing:-.01em}
.doc h2{font-size:23px;line-height:1.25;margin:48px 0 12px;padding-top:12px;border-top:1px solid var(--border);
  text-wrap:balance}
.doc h3{font-size:18px;margin:32px 0 8px;text-wrap:balance}
.doc h4{font-size:16px;margin:24px 0 6px}
.doc h1+p,.doc h1+blockquote{margin-top:0}
.doc p,.doc li{max-width:72ch}
.doc ul,.doc ol{padding-left:1.4em}
.doc li{margin:4px 0}
.doc li::marker{color:var(--faint)}
.doc hr{border:0;border-top:1px solid var(--border);margin:40px 0}
.doc blockquote{margin:20px 0;padding:14px 18px;background:var(--accent-soft);border-radius:12px;color:var(--text)}
.doc blockquote p{margin:6px 0}
.doc blockquote strong:first-child{color:var(--accent-strong)}
.doc :not(pre)>code{font-size:.88em;background:var(--surface-2);padding:.12em .38em;border-radius:6px;
  overflow-wrap:anywhere}
.table-wrap{overflow-x:auto;margin:18px 0;border:1px solid var(--border);border-radius:12px;background:var(--surface)}
.doc table{border-collapse:collapse;width:100%;font-size:14px;line-height:1.45}
.doc th,.doc td{padding:9px 12px;text-align:left;vertical-align:top;border-bottom:1px solid var(--border)}
.doc th{background:var(--surface-2);font-weight:600;white-space:nowrap}
.doc tr:last-child td{border-bottom:0}
.doc td code{white-space:nowrap}
.code{position:relative;margin:18px 0;border-radius:12px;background:var(--code-bg);overflow:hidden}
.code-head{display:flex;justify-content:space-between;align-items:center;padding:6px 8px 6px 14px;
  background:var(--code-head);font-size:12px;color:#b9b4ab;font-family:"IBM Plex Mono",monospace}
.copy{font:inherit;font-size:12px;color:#e6e3dd;background:transparent;border:1px solid #4a4e57;border-radius:7px;
  padding:4px 10px;cursor:pointer;min-height:30px}
.copy:hover{background:#3a3e46}
.code pre{margin:0;padding:14px 16px;overflow-x:auto;color:var(--code-fg);font-size:13.5px;line-height:1.55;
  -webkit-overflow-scrolling:touch}
.doc figure{margin:26px 0}
.doc figure img{display:block;width:100%;height:auto;border-radius:14px;border:1px solid var(--border)}
.doc figcaption{font-size:13px;color:var(--faint);margin-top:8px}
.doc input[type=checkbox]{margin-right:6px}
.pager{display:flex;justify-content:space-between;gap:16px;margin-top:56px;padding-top:20px;
  border-top:1px solid var(--border);flex-wrap:wrap}
.pager a{display:flex;flex-direction:column;gap:2px;padding:12px 16px;border:1px solid var(--border);
  border-radius:12px;text-decoration:none;color:var(--text);background:var(--surface);min-width:0;flex:1 1 220px}
.pager a small{color:var(--faint);font-size:12px}
.pager a.next{text-align:right}
.part-sep{margin-top:80px}
.topbar{display:none}

/* Pygments (tema escuro nos dois temas, casa com o bloco de código do chat) */
.hl .k,.hl .kn,.hl .kd,.hl .kr,.hl .kc,.hl .ow{color:#9fd9c5}
.hl .s,.hl .s1,.hl .s2,.hl .sb,.hl .sd,.hl .se,.hl .si,.hl .sh{color:#e7c07b}
.hl .c,.hl .c1,.hl .cm,.hl .ch,.hl .cs{color:#8a8f98;font-style:italic}
.hl .nf,.hl .fm{color:#a9c1ff}
.hl .nc,.hl .nn{color:#f0b5d0}
.hl .m,.hl .mi,.hl .mf{color:#f5a97f}
.hl .nt{color:#9fd9c5}
.hl .na,.hl .nb,.hl .bp{color:#c4b5fd}
.hl .p,.hl .o{color:#cfcac2}
.hl .err{color:inherit;background:none}

@media (max-width:1000px){
  .shell{grid-template-columns:minmax(0,1fr);padding-inline:16px;gap:0}
  .side{display:none}
  .topbar{display:flex;gap:6px;overflow-x:auto;position:sticky;top:env(safe-area-inset-top,0px);z-index:5;
    background:var(--bg);padding:10px 16px;border-bottom:1px solid var(--border);-webkit-overflow-scrolling:touch}
  .topbar a{flex:0 0 auto;padding:7px 12px;border-radius:999px;border:1px solid var(--border);font-size:13px;
    text-decoration:none;color:var(--dim);background:var(--surface);min-height:36px;display:flex;align-items:center}
  .topbar a.on{background:var(--accent-soft);color:var(--accent-strong);border-color:transparent;font-weight:600}
  main{padding-block:20px 72px}
  .doc h2{font-size:21px}
}
"""

JS = r"""
document.querySelectorAll('.copy').forEach(function(btn){
  btn.addEventListener('click',function(){
    var pre=btn.closest('.code').querySelector('pre');
    var text=pre.innerText;
    function done(){btn.textContent='Copiado';setTimeout(function(){btn.textContent='Copiar'},1400)}
    function fallback(){var r=document.createRange();r.selectNodeContents(pre);var s=getSelection();
      s.removeAllRanges();s.addRange(r);btn.textContent='Selecionado';}
    try{navigator.clipboard.writeText(text).then(done,fallback)}catch(e){fallback()}
  });
});
(function(){
  var btn=document.querySelector('.theme-btn'); if(!btn) return;
  var root=document.documentElement, key='tn-doc-theme';
  function label(){var t=root.getAttribute('data-theme');btn.textContent=t==='dark'?'Tema: escuro':t==='light'?'Tema: claro':'Tema: sistema'}
  try{var saved=localStorage.getItem(key); if(saved) root.setAttribute('data-theme',saved);}catch(e){}
  label();
  btn.addEventListener('click',function(){
    var t=root.getAttribute('data-theme'); var n=!t?'dark':t==='dark'?'light':null;
    if(n) root.setAttribute('data-theme',n); else root.removeAttribute('data-theme');
    try{n?localStorage.setItem(key,n):localStorage.removeItem(key)}catch(e){}
    label();
  });
})();
"""


def read(name: str) -> str:
    with open(os.path.join(HERE, name), encoding="utf-8") as fh:
        return fh.read()


def svg_data_uri(rel: str) -> str:
    with open(os.path.join(HERE, rel), "rb") as fh:
        return "data:image/svg+xml;base64," + base64.b64encode(fh.read()).decode()


def md_to_html(text: str, id_prefix: str):
    md = markdown.Markdown(
        extensions=["tables", "pymdownx.highlight", "pymdownx.superfences", "toc", "sane_lists", "attr_list"],
        extension_configs={
            "pymdownx.highlight": {"css_class": "hl", "guess_lang": False, "use_pygments": True},
            "toc": {"slugify": lambda v, s: id_prefix + slugify_unicode(v, s), "toc_depth": "2-3"},
        },
    )
    body = md.convert(text)
    # Linguagem de cada bloco cercado, na ordem em que aparecem (para o rótulo do cabeçalho).
    langs, inside = [], False
    for line in text.splitlines():
        m = re.match(r"^\s*```(\S*)", line)
        if m:
            if not inside:
                langs.append(m.group(1))
            inside = not inside
    return body, md.toc_tokens, langs


def postprocess(body: str, *, inline_images: bool, link_map, langs=()) -> str:
    # Imagens soltas num parágrafo viram <figure> com legenda (o alt).
    def fig(m):
        alt, src = m.group(1), m.group(2)
        real = svg_data_uri(src) if inline_images and src.startswith("img/") else src
        return (f'<figure><img src="{real}" alt="{alt}" loading="lazy">'
                f'<figcaption>{alt}</figcaption></figure>')
    body = re.sub(r'<p><img alt="([^"]*)" src="([^"]+)"\s*/?></p>', fig, body)
    # Tabelas com rolagem própria.
    body = body.replace("<table>", '<div class="table-wrap"><table>').replace("</table>", "</table></div>")
    # Blocos de código com cabeçalho + botão copiar. O codehilite embrulha em
    # <div class="hl">; blocos sem destaque saem como <pre><code> simples.
    def wrap(inner, lang):
        return (f'<div class="code"><div class="code-head"><span>{html.escape(lang or "texto")}</span>'
                f'<button class="copy" type="button">Copiar</button></div>{inner}</div>')

    queue = list(langs)
    labels = {"jsonc": "json", "text": "texto", "": "texto", "sql": "sql"}

    def lang_of(_inner):
        lang = queue.pop(0) if queue else ""
        return labels.get(lang, lang)

    body = re.sub(r'<div class="hl">(.*?)</div>', lambda m: wrap(m.group(1), lang_of(m.group(1))), body, flags=re.S)
    body = re.sub(r'(?<!</div>)<pre><code([^>]*)>(.*?)</code></pre>',
                  lambda m: wrap(f"<pre><code{m.group(1)}>{m.group(2)}</code></pre>", lang_of(m.group(1))),
                  body, flags=re.S)
    # Checklists "- [ ]" / "- [x]".
    body = body.replace("<li>[ ] ", '<li><input type="checkbox" disabled> ')
    body = body.replace("<li>[x] ", '<li><input type="checkbox" checked disabled> ')
    # Links entre partes.
    def link(m):
        target, anchor = m.group(1), m.group(2) or ""
        return f'href="{link_map(target, anchor)}"'
    body = re.sub(r'href="((?:\d\d-[\w-]+|README|CONTEXTO-PARA-AGENTE|documentacao-completa)\.md)(#[^"]*)?"', link, body)
    return body


def toc_html(tokens) -> str:
    def walk(items, depth):
        if not items:
            return ""
        out = ["<ul>"]
        for t in items:
            name = re.sub(r"<[^>]+>", "", t["name"])
            out.append(f'<li><a href="#{t["id"]}">{html.escape(name)}</a>')
            if depth < 2:
                out.append(walk(t.get("children", []), depth + 1))
            out.append("</li>")
        out.append("</ul>")
        return "".join(out)
    # toc_depth 2-3: tokens de topo já são os H2.
    return walk(tokens, 1)


def page(title: str, nav: str, topbar: str, toc: str, content: str) -> str:
    return f"""<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{html.escape(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>{CSS}</style>
</head>
<body>
<nav class="topbar" aria-label="Partes">{topbar}</nav>
<div class="shell">
  <aside class="side" aria-label="Navegação">
    <a class="brand" href="#top"><span class="brand-mark">TN</span><span class="brand-text"><b>{SITE_TITLE}</b><span>Design · UX · TL · Dev</span></span></a>
    {nav}
    <div class="toc"><p class="toc-title">Nesta página</p>{toc}</div>
    <button class="theme-btn" type="button">Tema: sistema</button>
  </aside>
  <main id="top">{content}</main>
</div>
<script>{JS}</script>
</body>
</html>
"""


def build_parts_nav(current: str | None, href_for) -> tuple[str, str]:
    items, pills = [], []
    for slug, num, label in PARTS:
        on = ' class="on"' if slug == current else ""
        items.append(f'<li><a{on} href="{href_for(slug)}"><span class="n">{num}</span><span>{html.escape(label)}</span></a></li>')
        pills.append(f'<a{on} href="{href_for(slug)}">{num} · {html.escape(label)}</a>')
    return f'<ul class="parts">{"".join(items)}</ul>', "".join(pills)


def build_per_part() -> None:
    def href(slug):
        return f"{slug}.html"

    def link_map(target, anchor):
        base = "index.html" if target == "README.md" else target.replace(".md", ".html")
        return base + anchor

    for i, (slug, num, label) in enumerate(PARTS):
        body, toks, langs = md_to_html(read(slug + ".md"), "")
        body = postprocess(body, inline_images=False, link_map=link_map, langs=langs)
        nav, pills = build_parts_nav(slug, href)
        prev_ = PARTS[i - 1] if i > 0 else None
        next_ = PARTS[i + 1] if i + 1 < len(PARTS) else None
        pager = '<div class="pager">'
        if prev_:
            pager += f'<a href="{href(prev_[0])}"><small>Anterior</small>{prev_[1]} · {html.escape(prev_[2])}</a>'
        if next_:
            pager += f'<a class="next" href="{href(next_[0])}"><small>Próxima</small>{next_[1]} · {html.escape(next_[2])}</a>'
        pager += "</div>"
        content = f'<article class="doc"><p class="eyebrow">{eyebrow(num)}</p>{body}{pager}</article>'
        out = page(f"{SITE_TITLE} · {label}", nav, pills, toc_html(toks), content)
        with open(os.path.join(HERE, slug + ".html"), "w", encoding="utf-8") as fh:
            fh.write(out)

    body, toks, langs = md_to_html(read("README.md"), "")
    body = postprocess(body, inline_images=False, link_map=link_map, langs=langs)
    nav, pills = build_parts_nav(None, href)
    out = page(SITE_TITLE, nav, pills, toc_html(toks), f'<article class="doc"><p class="eyebrow">Índice</p>{body}</article>')
    with open(os.path.join(HERE, "index.html"), "w", encoding="utf-8") as fh:
        fh.write(out)


def build_complete() -> None:
    def href(slug):
        return f"#parte-{slug[:2]}"

    def link_map(target, anchor):
        if target in ("README.md", "documentacao-completa.md"):
            return "#top"
        return anchor.replace("#", f"#p{target[:2]}-") if anchor else f"#parte-{target[:2]}"

    sections = []
    intro = read("README.md")
    # Na página única, o índice vira só a introdução (sem a tabela de links para .md/.html nem a seção de build).
    intro = intro.split("## Partes")[0]
    ibody, _, ilangs = md_to_html(intro, "intro-")
    ibody = postprocess(ibody, inline_images=True, link_map=link_map, langs=ilangs)
    sections.append(f'<article class="doc"><p class="eyebrow">Documentação completa</p>{ibody}</article>')
    for slug, num, label in PARTS:
        body, _, langs = md_to_html(read(slug + ".md"), f"p{slug[:2]}-")
        body = postprocess(body, inline_images=True, link_map=link_map, langs=langs)
        sections.append(
            f'<article class="doc part-sep" id="parte-{slug[:2]}"><p class="eyebrow">{eyebrow(num)}</p>{body}</article>')
    nav, pills = build_parts_nav(None, href)
    toc = ""  # a lista de partes já é o índice nesta versão
    out = page(SITE_TITLE, nav, pills, toc, "".join(sections))
    out = out.replace('<div class="toc"><p class="toc-title">Nesta página</p></div>', "")
    with open(os.path.join(HERE, "documentacao-completa.html"), "w", encoding="utf-8") as fh:
        fh.write(out)


def build_complete_md() -> None:
    """Um único Markdown com todas as partes, na mesma ordem do site. Os links
    entre partes continuam apontando para os .md separados (que moram na mesma
    pasta), e as imagens continuam em img/ — funciona no GitHub e para um agente."""
    chunks = [
        "# TaskNexus no tablet — documentação completa (arquivo único)\n\n"
        "> Gerado por `build_html.py` a partir dos .md desta pasta. Não edite este\n"
        "> arquivo: edite as partes e rode o script de novo.\n\n"
        "## Sumário\n\n"
        + "\n".join(f"- {num} · {label} (`{slug}.md`)" for slug, num, label in PARTS)
        + "\n"
    ]
    for slug, num, label in PARTS:
        text = read(slug + ".md").strip()
        # Rebaixa um nível todos os títulos (fora de blocos de código) para caberem sob o título do arquivo único.
        out, inside = [], False
        for line in text.splitlines():
            if re.match(r"^\s*```", line):
                inside = not inside
            if not inside and re.match(r"^#{1,5} ", line):
                line = "#" + line
            out.append(line)
        chunks.append(f"\n---\n\n<!-- ===== {slug}.md ===== -->\n\n" + "\n".join(out) + "\n")
    with open(os.path.join(HERE, "documentacao-completa.md"), "w", encoding="utf-8") as fh:
        fh.write("".join(chunks))


if __name__ == "__main__":
    build_per_part()
    build_complete()
    build_complete_md()
    print("HTML gerado em", HERE)
