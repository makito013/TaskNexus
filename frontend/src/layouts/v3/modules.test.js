import { describe, it, expect } from 'vitest'
import {
  MODULES,
  DEFAULT_MODULE_ID,
  PET_NAMES,
  colleaguesOf,
  moduleById,
  moduleForPath,
} from './modules.js'

describe('modules', () => {
  it('lists the five modules in rail order', () => {
    expect(MODULES.map((module) => module.id)).toEqual(['home', 'tasks', 'finance', 'projects', 'browser'])
    expect(MODULES.map((module) => module.pet)).toEqual(['bit', 'tiq', 'fin', 'kan', 'navi'])
    expect(MODULES.map((module) => module.path)).toEqual([
      '/home', '/tasks', '/finance', '/projects', '/browser',
    ])
  })

  it('resolves a path to its module and null for unknown paths', () => {
    expect(moduleForPath('/finance').id).toBe('finance')
    expect(moduleForPath('/finance/').id).toBe('finance')
    expect(moduleForPath('/')).toBeNull()
    expect(moduleForPath('/tarefas')).toBeNull()
    expect(moduleForPath('/dev/gallery')).toBeNull()
  })

  it('only tasks is ready and the default module', () => {
    expect(MODULES.filter((module) => module.ready).map((module) => module.id)).toEqual(['tasks'])
    expect(DEFAULT_MODULE_ID).toBe('tasks')
    expect(moduleById(DEFAULT_MODULE_ID).ready).toBe(true)
  })

  it('every module that is not ready has coming-soon copy and an accessible name that says so', () => {
    for (const module of MODULES.filter((entry) => !entry.ready)) {
      expect(module.comingSoonCopy).toBeTruthy()
      expect(module.ariaLabel.toLowerCase()).toContain('em breve')
      expect(module.ariaLabel).toContain(module.label)
    }
  })

  it('colleaguesOf excludes the active module and keeps rail order', () => {
    expect(colleaguesOf('tasks').map((module) => module.id)).toEqual(['home', 'finance', 'projects', 'browser'])
    expect(colleaguesOf('browser').map((module) => module.id)).toEqual(['home', 'tasks', 'finance', 'projects'])
  })

  it('names the five pets', () => {
    expect(PET_NAMES).toEqual({ bit: 'Bit', tiq: 'Tiq', fin: 'Fin', kan: 'Kan', navi: 'Navi' })
  })
})
