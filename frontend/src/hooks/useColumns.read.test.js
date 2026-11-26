// readError and refetch of useColumns (V3 board). The V2 ignores both.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { api } from '../services/api.js';
import { useColumns } from './useColumns.js';

const columns = [
  { slug: 'a_fazer', label: 'A fazer', position: 1, is_done: false },
  { slug: 'feito', label: 'Feito', position: 2, is_done: true },
];

afterEach(() => vi.restoreAllMocks());
beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}));

describe('useColumns read state', () => {
  it('has no error after a good read', async () => {
    vi.spyOn(api, 'fetchBoardColumns').mockResolvedValue(columns);
    const { result } = renderHook(() => useColumns());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.readError).toBeNull();
    expect(result.current.columns).toEqual(columns);
    expect(result.current.doneSlug).toBe('feito');
  });

  it('exposes the error of a failed read, with the columns still empty and loading over', async () => {
    const failure = new Error('down');
    vi.spyOn(api, 'fetchBoardColumns').mockRejectedValue(failure);
    const { result } = renderHook(() => useColumns());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.readError).toBe(failure);
    expect(result.current.columns).toEqual([]);
  });

  it('refetch recovers: the columns arrive and the error clears', async () => {
    const fetchColumns = vi.spyOn(api, 'fetchBoardColumns');
    fetchColumns.mockRejectedValueOnce(new Error('down'));
    const { result } = renderHook(() => useColumns());
    await waitFor(() => expect(result.current.readError).not.toBeNull());

    fetchColumns.mockResolvedValueOnce(columns);
    await act(async () => { await result.current.refetch(); });
    expect(result.current.readError).toBeNull();
    expect(result.current.columns).toEqual(columns);
  });

  it('a failing refetch keeps the columns already on screen', async () => {
    const fetchColumns = vi.spyOn(api, 'fetchBoardColumns');
    fetchColumns.mockResolvedValueOnce(columns);
    const { result } = renderHook(() => useColumns());
    await waitFor(() => expect(result.current.columns).toEqual(columns));

    fetchColumns.mockRejectedValueOnce(new Error('down'));
    await act(async () => { await result.current.refetch(); });
    expect(result.current.columns).toEqual(columns);
    expect(result.current.readError).toBeInstanceOf(Error);
  });

  it('refetch keeps its identity and resolves to undefined', async () => {
    vi.spyOn(api, 'fetchBoardColumns').mockResolvedValue(columns);
    const { result, rerender } = renderHook(() => useColumns());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const first = result.current.refetch;
    rerender();
    expect(result.current.refetch).toBe(first);
    await expect(first()).resolves.toBeUndefined();
  });

  it('an answer after unmount does not touch state', async () => {
    let resolve;
    vi.spyOn(api, 'fetchBoardColumns').mockReturnValue(new Promise((done) => { resolve = done; }));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { unmount } = renderHook(() => useColumns());
    unmount();
    await act(async () => { resolve(columns); });
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
