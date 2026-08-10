// frontend/src/components/AppearanceSwitch.test.jsx
// Cobre o requisito mais crítico deste componente (achado do TL, ainda
// válido após a remoção do botão "Aplicar"): window.location.reload() só
// pode rodar DEPOIS que o PUT /api/settings/appearance resolver com sucesso;
// uma falha de PUT nunca recarrega a página. Também cobre o comportamento
// pedido pelo Bruno: cada clique num segmento salva e recarrega na hora, sem
// um botão de confirmação separado.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { AppearanceSwitch } from './AppearanceSwitch.jsx';
import { api } from '../services/api.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

let reloadSpy;

beforeEach(() => {
  // jsdom's window.location.reload throws "not implemented" if called for
  // real — replace it with a spy so we can assert on calls without jsdom
  // trying to actually navigate.
  reloadSpy = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, reload: reloadSpy },
  });
});

describe('AppearanceSwitch', () => {
  it('renders the Layout control but hides Tema while the persisted layout is v1', () => {
    render(<AppearanceSwitch initialAppearance={{ layout_version: 'v1', theme_mode: 'dark' }} />);
    expect(screen.getByText('Layout:')).toBeTruthy();
    expect(screen.queryByText('Tema:')).toBeNull();
  });

  it('shows Tema when the persisted layout is already v2', () => {
    render(<AppearanceSwitch initialAppearance={{ layout_version: 'v2', theme_mode: 'dark' }} />);
    expect(screen.getByText('Tema:')).toBeTruthy();
  });

  it('saves and reloads as soon as a different layout option is clicked — no Aplicar button', async () => {
    const updateSpy = vi.spyOn(api, 'updateAppearance').mockResolvedValue({ layout_version: 'v2', theme_mode: 'dark' });
    render(<AppearanceSwitch initialAppearance={{ layout_version: 'v1', theme_mode: 'dark' }} />);

    expect(screen.queryByRole('button', { name: /Aplicar/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'v2' }));

    expect(reloadSpy).not.toHaveBeenCalled();
    expect(updateSpy).toHaveBeenCalledWith({ layout_version: 'v2' });

    await waitFor(() => expect(reloadSpy).toHaveBeenCalledTimes(1));
  });

  it('saves the theme directly when clicked (persisted layout already v2)', async () => {
    const updateSpy = vi.spyOn(api, 'updateAppearance').mockResolvedValue({ layout_version: 'v2', theme_mode: 'light' });
    render(<AppearanceSwitch initialAppearance={{ layout_version: 'v2', theme_mode: 'dark' }} />);

    fireEvent.click(screen.getByRole('button', { name: 'Claro' }));

    expect(updateSpy).toHaveBeenCalledWith({ theme_mode: 'light' });
    await waitFor(() => expect(reloadSpy).toHaveBeenCalledTimes(1));
  });

  it('does nothing when clicking the option that is already selected', () => {
    const updateSpy = vi.spyOn(api, 'updateAppearance');
    render(<AppearanceSwitch initialAppearance={{ layout_version: 'v1', theme_mode: 'dark' }} />);

    fireEvent.click(screen.getByRole('button', { name: 'v1' }));

    expect(updateSpy).not.toHaveBeenCalled();
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('does NOT reload and shows an inline error when updateAppearance rejects', async () => {
    vi.spyOn(api, 'updateAppearance').mockRejectedValue(new Error('network down'));
    render(<AppearanceSwitch initialAppearance={{ layout_version: 'v1', theme_mode: 'dark' }} />);

    fireEvent.click(screen.getByRole('button', { name: 'v2' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  // A rapid second click on the same segment while the first PUT is still in
  // flight must NOT fire a second request — the segment buttons are disabled
  // synchronously via `saving`, before the awaited PUT settles.
  it('does not fire a second updateAppearance call on a rapid second click while saving', async () => {
    let resolvePut;
    const updateSpy = vi.spyOn(api, 'updateAppearance').mockImplementation(
      () => new Promise((resolve) => { resolvePut = resolve; })
    );
    render(<AppearanceSwitch initialAppearance={{ layout_version: 'v1', theme_mode: 'dark' }} />);

    const v2Btn = screen.getByRole('button', { name: 'v2' });
    fireEvent.click(v2Btn);
    fireEvent.click(v2Btn); // fired before the PUT above resolves

    expect(updateSpy).toHaveBeenCalledTimes(1);

    resolvePut({ layout_version: 'v2', theme_mode: 'dark' });
    await waitFor(() => expect(reloadSpy).toHaveBeenCalledTimes(1));
    expect(updateSpy).toHaveBeenCalledTimes(1);
  });
});
