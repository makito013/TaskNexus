import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderChatMarkdown } from '../chat/chatMarkdown.js'
import { decorateFileLinks, fileTargetOf, relativeLinkPath } from './fileLinks.js'

// The decorated HTML as a DOM, to ask questions of it instead of matching strings.
const dom = (html) => {
  const root = document.createElement('div')
  root.append(...new DOMParser().parseFromString(html, 'text/html').body.childNodes)
  return root
}
const buttons = (html) => [...dom(html).querySelectorAll('button[data-file-path]')]
const paths = (html) => buttons(html).map((button) => button.getAttribute('data-file-path'))

describe('decorateFileLinks: what becomes a button', () => {
  it('turns a path in a paragraph into a button with the path, no line and an accessible name', () => {
    const [button] = buttons(decorateFileLinks('<p>Veja docs/plano.md agora.</p>'))

    expect(button.getAttribute('type')).toBe('button')
    expect(button.getAttribute('data-file-path')).toBe('docs/plano.md')
    expect(button.hasAttribute('data-file-line')).toBe(false)
    expect(button.getAttribute('aria-label')).toBe('Abrir docs/plano.md no visualizador')
    expect(button.textContent).toBe('docs/plano.md')
    expect(dom(decorateFileLinks('<p>Veja docs/plano.md agora.</p>')).textContent).toBe('Veja docs/plano.md agora.')
  })

  it('keeps the line of `src/app.py:42` and shows the whole text, the accessible name included', () => {
    const [button] = buttons(decorateFileLinks('<p>Erro em src/app.py:42.</p>'))

    expect(button.getAttribute('data-file-path')).toBe('src/app.py')
    expect(button.getAttribute('data-file-line')).toBe('42')
    expect(button.textContent).toBe('src/app.py:42')
    expect(button.getAttribute('aria-label')).toBe('Abrir src/app.py:42 no visualizador')
  })

  it('finds several paths in one text node and keeps the text around them in order', () => {
    const html = decorateFileLinks('<p>a.md, ./b/c.ts:3 e /abs/d.py</p>')

    expect(paths(html)).toEqual(['a.md', './b/c.ts', '/abs/d.py'])
    expect(dom(html).textContent).toBe('a.md, ./b/c.ts:3 e /abs/d.py')
  })

  it('decorates a path in INLINE code, in a list item and in a table cell', () => {
    expect(paths(decorateFileLinks('<p><code>src/app.py</code></p>'))).toEqual(['src/app.py'])
    expect(paths(decorateFileLinks('<ul><li>Editei src/x.js</li></ul>'))).toEqual(['src/x.js'])
    expect(paths(decorateFileLinks('<table><tbody><tr><td>docs/a.md</td></tr></tbody></table>'))).toEqual(['docs/a.md'])
    expect(dom(decorateFileLinks('<p><code>src/app.py</code></p>')).querySelector('code > button')).not.toBeNull()
  })

  it('leaves a code BLOCK (pre) exactly as it was', () => {
    const html = '<pre><code class="language-py">open("src/app.py:42")\n# docs/plano.md</code></pre>'

    expect(decorateFileLinks(html)).toBe(html)
  })

  it('leaves the text of a link, of a button and what is inside them alone', () => {
    const link = '<p><a href="https://x.com/a.md">docs/plano.md</a></p>'
    const button = '<p><button>docs/plano.md</button></p>'

    expect(decorateFileLinks(link)).toBe(link)
    expect(decorateFileLinks(button)).toBe(button)
    expect(paths(decorateFileLinks('<p><a href="r.md"><code>docs/x.md</code></a> e docs/y.md</p>'))).toEqual(['docs/y.md'])
  })

  it('leaves a path inside a <summary> alone (no interactive element nested in the details control)', () => {
    const html = '<details><summary>Mudei src/app.py</summary><p>e docs/y.md</p></details>'

    expect(paths(decorateFileLinks(html))).toEqual(['docs/y.md'])
    expect(decorateFileLinks(html)).toContain('<summary>Mudei src/app.py</summary>')
  })

  it.each([
    ['a URL', '<p>https://github.com/org/repo/blob/main/README.md</p>'],
    ['a URL with a line', '<p>https://x.test/a/b.py:10</p>'],
    ['a folder', '<p>a pasta docs/ e src/components</p>'],
    ['a version', '<p>versão v1.2 e 3.4.5 e 1.5</p>'],
    ['a site', '<p>github.com e e.g. etc.</p>'],
    ['an e-mail', '<p>ana@empresa.com.br</p>'],
    ['a name with an unknown extension and no folder', '<p>arquivo.zzz e outro.qqq</p>'],
    ['plain text', '<p>nada de arquivo aqui</p>'],
  ])('leaves %s as text and returns the very same string', (_name, html) => {
    expect(decorateFileLinks(html)).toBe(html)
  })

  it('returns what it is given when there is nothing to decorate (empty, not a string)', () => {
    expect(decorateFileLinks('')).toBe('')
    expect(decorateFileLinks(undefined)).toBeUndefined()
    expect(decorateFileLinks(null)).toBeNull()
  })
})

describe('decorateFileLinks: the text of the agent never becomes markup', () => {
  it('a name with <img onerror> stays text: no element is born from it and the attribute is only data', () => {
    const rendered = renderChatMarkdown('Abra docs/<img src=x onerror=alert(1)>.md e `a/<img src=x onerror=alert(2)>b.py`')
    const root = dom(decorateFileLinks(rendered))

    expect(root.querySelector('img')).toBeNull()
    for (const element of root.querySelectorAll('*')) {
      expect([...element.attributes].map((attribute) => attribute.name).filter((name) => name.startsWith('on'))).toEqual([])
    }
    // The raw tag of the text was removed by the profile of the chat; the one inside the code span is only text.
    expect(root.textContent).toContain('<img src=x onerror=alert(2)>')
  })

  it('quotes around a path cannot leak into the attributes: only the path is data', () => {
    const html = decorateFileLinks(`<p>"onmouseover=alert(1) x/c.md" e 'y/d.md'</p>`)
    const root = dom(html)

    expect(root.querySelector('[onmouseover]')).toBeNull()
    expect(paths(html)).toEqual(['x/c.md', 'y/d.md'])
    expect(buttons(html).map((button) => [...button.attributes].map((attribute) => attribute.name).sort())).toEqual([
      ['aria-label', 'class', 'data-file-path', 'type'],
      ['aria-label', 'class', 'data-file-path', 'type'],
    ])
  })

  it('does not change anything the profile of renderChatMarkdown removed (no id, no style, no raw html)', () => {
    const rendered = renderChatMarkdown('<span style="color:red" id="x">docs/a.md</span> **b.md**')
    const root = dom(decorateFileLinks(rendered))

    expect(root.querySelector('[style]')).toBeNull()
    expect(root.querySelector('[id]')).toBeNull()
    expect(paths(decorateFileLinks(rendered))).toEqual(['docs/a.md', 'b.md'])
  })

  it('a decorated message is stable: decorating twice adds no button', () => {
    const once = decorateFileLinks('<p>docs/plano.md e src/app.py:42</p>')

    expect(decorateFileLinks(once)).toBe(once)
  })

  it('never assigns innerHTML or writes HTML: the source only reads it', () => {
    const here = path.dirname(fileURLToPath(import.meta.url))
    const source = readFileSync(path.join(here, 'fileLinks.js'), 'utf8').replace(/\/\/.*$/gm, '')

    expect(source).not.toMatch(/innerHTML\s*=/)
    expect(source).not.toMatch(/insertAdjacentHTML|outerHTML\s*=|document\.write|dangerouslySetInnerHTML/)
  })
})

describe('relativeLinkPath', () => {
  it.each([
    ['docs/plano.md', 'docs/plano.md'],
    ['./docs/plano.md', './docs/plano.md'],
    ['../x/y.md', '../x/y.md'],
    ['/abs/x.md', '/abs/x.md'],
    ['docs/plano.md#L10', 'docs/plano.md#L10'],
    ['docs/plano.md#secao', 'docs/plano.md#secao'],
    ['docs/meu%20arquivo.md', 'docs/meu arquivo.md'],
    ['docs/bad%zz.md', 'docs/bad%zz.md'],
    ['  docs/a.md  ', 'docs/a.md'],
    ['docs/a.md?x=1', 'docs/a.md'],
  ])('%s opens %s', (href, expected) => {
    expect(relativeLinkPath(href)).toBe(expected)
  })

  it.each([
    ['an anchor', '#secao'],
    ['https', 'https://x.com/a.md'],
    ['http', 'http://x.com'],
    ['mailto', 'mailto:a@b.c'],
    ['a protocol-relative url', '//x.com/a.md'],
    ['javascript', 'javascript:alert(1)'],
    ['empty', ''],
    ['blank', '   '],
    ['only a query', '?x=1'],
    ['null', null],
  ])('%s is not for the viewer', (_name, href) => {
    expect(relativeLinkPath(href)).toBeNull()
  })
})

describe('fileTargetOf', () => {
  const root = dom(
    decorateFileLinks(
      '<p>Veja src/app.py:42 e <a href="docs/plano.md#L3">o plano</a>, <a href="#topo">topo</a>, '
        + '<a href="https://x.com">site</a> e <em>docs/em.md</em></p>',
    ),
  )

  it('reads a decorated button, with and without a line', () => {
    const button = root.querySelector('button[data-file-path="src/app.py"]')
    expect(fileTargetOf(button, root)).toEqual({ path: 'src/app.py', line: 42 })
    expect(fileTargetOf(root.querySelector('em button'), root)).toEqual({ path: 'docs/em.md', line: null })
  })

  it('reads a relative link, the text inside it included, and ignores the anchor and the external one', () => {
    const [plan, top, site] = root.querySelectorAll('a')
    expect(fileTargetOf(plan, root)).toEqual({ path: 'docs/plano.md#L3', line: null })
    expect(fileTargetOf(top, root)).toBeNull()
    expect(fileTargetOf(site, root)).toBeNull()
  })

  it('answers null for anything else and for something that is not an element', () => {
    expect(fileTargetOf(root.querySelector('p'), root)).toBeNull()
    expect(fileTargetOf(document.createTextNode('x'), root)).toBeNull()
    expect(fileTargetOf(null, root)).toBeNull()
  })

  it('does not follow a button or a link that is outside the root', () => {
    const outside = dom(decorateFileLinks('<p>fora/x.md</p>'))
    expect(fileTargetOf(outside.querySelector('button'), root)).toBeNull()
  })

  it('an invalid line is no line', () => {
    const element = document.createElement('div')
    element.innerHTML = '<button data-file-path="a.md" data-file-line="0"></button><button data-file-path="b.md" data-file-line="x"></button>'
    const [zero, text] = element.querySelectorAll('button')
    expect(fileTargetOf(zero, element)).toEqual({ path: 'a.md', line: null })
    expect(fileTargetOf(text, element)).toEqual({ path: 'b.md', line: null })
  })
})
