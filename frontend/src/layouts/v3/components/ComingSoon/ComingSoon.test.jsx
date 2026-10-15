import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ComingSoon from './ComingSoon.jsx'
import { moduleById } from '../../modules.js'

describe('ComingSoon', () => {
  it('renders the module heading, the Em breve chip and the pet copy', () => {
    const module = moduleById('finance')
    render(<ComingSoon module={module} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Finanças' })).toBeTruthy()
    expect(screen.getByText('Em breve')).toBeTruthy()
    expect(screen.getByText(module.comingSoonCopy)).toBeTruthy()
    expect(document.querySelector('.v3-pet--fin.v3-pet--sleeping')).toBeTruthy()
  })

  it('does not steal focus on its own (the shell moves it on module change)', () => {
    render(<ComingSoon module={moduleById('browser')} />)
    expect(document.activeElement).not.toBe(screen.getByRole('heading', { level: 1 }))
  })

  it('sets the document title', () => {
    render(<ComingSoon module={moduleById('home')} />)
    expect(document.title).toBe('Início · TaskNexus')
  })

  it('tells where to find projects and agents while the module is not ready', () => {
    render(<ComingSoon module={moduleById('projects')} />)
    expect(screen.getByText(/sem --v3/)).toBeTruthy()
  })
})
