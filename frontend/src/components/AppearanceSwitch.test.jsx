// frontend/src/components/AppearanceSwitch.test.jsx
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
  reloadSpy = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, reload: reloadSpy },
  });
});

describe('AppearanceSwitch', () => {
  it('renders Tema control with Claro and Escuro buttons, but no Layout selector', () => {
    render(<AppearanceSwitch initialAppearance={{ layout_version: 'v2', theme_mode: 'light' }} />);
    expect(screen.getByText('Tema:')).toBeTruthy();
    expect(screen.queryByText('Layout:')).toBeNull();
    expect(screen.getByRole('button', { name: 'Claro' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Escuro' })).toBeTruthy();
  });

  it('saves the theme and reloads when clicking a different theme', async () => {
    const updateSpy = vi.spyOn(api, 'updateAppearance').mockResolvedValue({ layout_version: 'v2', theme_mode: 'dark' });
    render(<AppearanceSwitch initialAppearance={{ layout_version: 'v2', theme_mode: 'light' }} />);

    fireEvent.click(screen.getByRole('button', { name: 'Escuro' }));

    expect(updateSpy).toHaveBeenCalledWith({ theme_mode: 'dark', layout_version: 'v2' });
    await waitFor(() => expect(reloadSpy).toHaveBeenCalledTimes(1));
  });

  it('does nothing when clicking the theme option that is already selected', () => {
    const updateSpy = vi.spyOn(api, 'updateAppearance');
    render(<AppearanceSwitch initialAppearance={{ layout_version: 'v2', theme_mode: 'light' }} />);

    fireEvent.click(screen.getByRole('button', { name: 'Claro' }));

    expect(updateSpy).not.toHaveBeenCalled();
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('does NOT reload and shows an inline error when updateAppearance rejects', async () => {
    vi.spyOn(api, 'updateAppearance').mockRejectedValue(new Error('network down'));
    render(<AppearanceSwitch initialAppearance={{ layout_version: 'v2', theme_mode: 'light' }} />);

    fireEvent.click(screen.getByRole('button', { name: 'Escuro' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('does not fire a second updateAppearance call on a rapid second click while saving', async () => {
    let resolvePut;
    const updateSpy = vi.spyOn(api, 'updateAppearance').mockImplementation(
      () => new Promise((resolve) => { resolvePut = resolve; })
    );
    render(<AppearanceSwitch initialAppearance={{ layout_version: 'v2', theme_mode: 'light' }} />);

    const darkBtn = screen.getByRole('button', { name: 'Escuro' });
    fireEvent.click(darkBtn);
    fireEvent.click(darkBtn);

    expect(updateSpy).toHaveBeenCalledTimes(1);

    resolvePut({ layout_version: 'v2', theme_mode: 'dark' });
    await waitFor(() => expect(reloadSpy).toHaveBeenCalledTimes(1));
    expect(updateSpy).toHaveBeenCalledTimes(1);
  });
});
