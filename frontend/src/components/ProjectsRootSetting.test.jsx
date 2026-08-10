// frontend/src/components/ProjectsRootSetting.test.jsx
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ProjectsRootSetting } from './ProjectsRootSetting.jsx';
import { api } from '../services/api.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

let reloadSpy;

beforeEach(() => {
  reloadSpy = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, reload: reloadSpy },
  });
  vi.spyOn(api, 'fetchProjectsRoot').mockResolvedValue({
    projects_root_path: null,
    resolved_path: '/home/bruno/projetos',
  });
});

describe('ProjectsRootSetting', () => {
  it('shows the resolved path after loading', async () => {
    render(<ProjectsRootSetting />);
    await waitFor(() => expect(screen.getByText('/home/bruno/projetos')).toBeTruthy());
  });

  it('browses, saves and reloads when a folder is picked', async () => {
    const browseSpy = vi.spyOn(api, 'browseProjectsRootFolder').mockResolvedValue({ path: 'D:\\projetos' });
    const updateSpy = vi.spyOn(api, 'updateProjectsRoot').mockResolvedValue({
      projects_root_path: 'D:\\projetos', resolved_path: 'D:\\projetos',
    });
    render(<ProjectsRootSetting />);
    await waitFor(() => expect(screen.getByText('/home/bruno/projetos')).toBeTruthy());

    fireEvent.click(screen.getByText('Procurar…'));

    await waitFor(() => expect(browseSpy).toHaveBeenCalled());
    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith('D:\\projetos'));
    await waitFor(() => expect(reloadSpy).toHaveBeenCalledTimes(1));
  });

  it('does nothing when the user cancels the native dialog', async () => {
    vi.spyOn(api, 'browseProjectsRootFolder').mockResolvedValue({ path: null });
    const updateSpy = vi.spyOn(api, 'updateProjectsRoot');
    render(<ProjectsRootSetting />);
    await waitFor(() => expect(screen.getByText('/home/bruno/projetos')).toBeTruthy());

    fireEvent.click(screen.getByText('Procurar…'));

    await waitFor(() => expect(api.browseProjectsRootFolder).toHaveBeenCalled());
    expect(updateSpy).not.toHaveBeenCalled();
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('shows an inline error and does not reload when the PUT fails', async () => {
    vi.spyOn(api, 'browseProjectsRootFolder').mockResolvedValue({ path: 'D:\\projetos' });
    vi.spyOn(api, 'updateProjectsRoot').mockRejectedValue(new Error('Pasta não encontrada'));
    render(<ProjectsRootSetting />);
    await waitFor(() => expect(screen.getByText('/home/bruno/projetos')).toBeTruthy());

    fireEvent.click(screen.getByText('Procurar…'));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(reloadSpy).not.toHaveBeenCalled();
  });
});

// Segunda forma de escolher a pasta, para quando o diálogo nativo não serve
// (acesso remoto: o backend abriria o seletor na máquina errada). Termina no
// MESMO api.updateProjectsRoot, com a mesma validação server-side e o mesmo
// role="alert".
describe('ProjectsRootSetting — campo de caminho manual', () => {
  const typePath = (value) =>
    fireEvent.change(screen.getByLabelText('Caminho da pasta de projetos'), { target: { value } });

  const clickSave = () => fireEvent.click(screen.getByRole('button', { name: 'Salvar pasta' }));

  it('starts empty, with the current path only as a placeholder', async () => {
    render(<ProjectsRootSetting />);
    await waitFor(() => expect(screen.getByText('/home/bruno/projetos')).toBeTruthy());

    const input = screen.getByLabelText('Caminho da pasta de projetos');
    expect(input.value).toBe('');
    expect(input.placeholder).toBe('/home/bruno/projetos');
  });

  it('saves the typed path and reloads, without touching the native picker', async () => {
    const updateSpy = vi.spyOn(api, 'updateProjectsRoot').mockResolvedValue({
      projects_root_path: 'D:\\projetos', resolved_path: 'D:\\projetos',
    });
    const browseSpy = vi.spyOn(api, 'browseProjectsRootFolder');
    render(<ProjectsRootSetting />);
    await waitFor(() => expect(screen.getByText('/home/bruno/projetos')).toBeTruthy());

    typePath('D:\\projetos');
    clickSave();

    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith('D:\\projetos'));
    await waitFor(() => expect(reloadSpy).toHaveBeenCalledTimes(1));
    expect(browseSpy).not.toHaveBeenCalled();
  });

  it('trims surrounding whitespace before sending the path', async () => {
    const updateSpy = vi.spyOn(api, 'updateProjectsRoot').mockResolvedValue({
      projects_root_path: 'D:\\projetos', resolved_path: 'D:\\projetos',
    });
    render(<ProjectsRootSetting />);
    await waitFor(() => expect(screen.getByText('/home/bruno/projetos')).toBeTruthy());

    typePath('  D:\\projetos  ');
    clickSave();

    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith('D:\\projetos'));
  });

  it('is a no-op on an empty (or whitespace-only) field — no PUT, no reload', async () => {
    const updateSpy = vi.spyOn(api, 'updateProjectsRoot');
    render(<ProjectsRootSetting />);
    await waitFor(() => expect(screen.getByText('/home/bruno/projetos')).toBeTruthy());

    clickSave();
    typePath('   ');
    clickSave();

    expect(updateSpy).not.toHaveBeenCalled();
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  // Revisor: antes disso o botão ficava clicável com o campo vazio e não
  // dava NENHUM sinal — clicar parecia não fazer nada. Desabilitar é mais
  // claro que aceitar o clique em silêncio.
  it('disables "Salvar pasta" while the field is empty or whitespace-only', async () => {
    render(<ProjectsRootSetting />);
    await waitFor(() => expect(screen.getByText('/home/bruno/projetos')).toBeTruthy());

    const saveBtn = screen.getByRole('button', { name: 'Salvar pasta' });
    expect(saveBtn.disabled).toBe(true);

    typePath('   ');
    expect(saveBtn.disabled).toBe(true);

    typePath('D:\\projetos');
    expect(saveBtn.disabled).toBe(false);
  });

  it('shows the backend rejection inline and does not reload when the path does not exist', async () => {
    vi.spyOn(api, 'updateProjectsRoot').mockRejectedValue(new Error('Pasta não encontrada: D:\\nao-existe'));
    render(<ProjectsRootSetting />);
    await waitFor(() => expect(screen.getByText('/home/bruno/projetos')).toBeTruthy());

    typePath('D:\\nao-existe');
    clickSave();

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Pasta não encontrada'));
    expect(reloadSpy).not.toHaveBeenCalled();
    // Um único alerta vivo: as duas formas compartilham o mesmo `error`.
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });
});
