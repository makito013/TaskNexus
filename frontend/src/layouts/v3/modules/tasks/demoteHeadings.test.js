import { describe, it, expect } from 'vitest'
import { demoteHeadings } from './demoteHeadings.js'

describe('demoteHeadings', () => {
  it('pushes headings two levels down and caps at h6', () => {
    expect(demoteHeadings('<h1>A</h1><h2 id="x">B</h2><h5>C</h5><h6>D</h6>'))
      .toBe('<h3>A</h3><h4 id="x">B</h4><h6>C</h6><h6>D</h6>')
  })

  it('leaves escaped text and other tags alone', () => {
    expect(demoteHeadings('<p>&lt;h1&gt; and <hr><header>x</header></p>'))
      .toBe('<p>&lt;h1&gt; and <hr><header>x</header></p>')
  })
})
