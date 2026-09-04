// frontend/src/utils/clipboard.test.js
// ⚠️ jsdom has no `navigator.clipboard` and its `document.execCommand` does
// not copy anything — these tests prove the DECISION FLOW (which path runs,
// what the return value is), never that text actually reached the OS
// clipboard. Real copying is manual QA, specifically over the Tailscale HTTP
// origin, which is the reason the fallback exists at all.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { copyTextToClipboard } from './clipboard.js';

const originalExecCommand = document.execCommand;

function stubClipboard(writeText) {
  Object.defineProperty(navigator, 'clipboard', {
    value: writeText ? { writeText } : undefined,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  stubClipboard(undefined);
  document.execCommand = originalExecCommand;
  vi.restoreAllMocks();
});

describe('copyTextToClipboard', () => {
  it('uses navigator.clipboard when available and does not touch execCommand', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const execCommand = vi.fn().mockReturnValue(true);
    stubClipboard(writeText);
    document.execCommand = execCommand;

    await expect(copyTextToClipboard('123')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('123');
    expect(execCommand).not.toHaveBeenCalled();
  });

  it('falls back to execCommand when navigator.clipboard is undefined (insecure origin)', async () => {
    const execCommand = vi.fn().mockReturnValue(true);
    stubClipboard(undefined);
    document.execCommand = execCommand;

    await expect(copyTextToClipboard('123')).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('falls back to execCommand when writeText REJECTS (API present but refused)', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    const execCommand = vi.fn().mockReturnValue(true);
    stubClipboard(writeText);
    document.execCommand = execCommand;

    await expect(copyTextToClipboard('123')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalled();
    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('returns false, without throwing, when the fallback fails too', async () => {
    stubClipboard(undefined);
    document.execCommand = vi.fn(() => { throw new Error('not supported'); });

    await expect(copyTextToClipboard('123')).resolves.toBe(false);
  });

  it('removes the temporary textarea from the document either way', async () => {
    stubClipboard(undefined);
    document.execCommand = vi.fn().mockReturnValue(false);

    await copyTextToClipboard('123');
    expect(document.querySelectorAll('textarea').length).toBe(0);
  });

  it('returns false for empty text without trying any copy path', async () => {
    const execCommand = vi.fn().mockReturnValue(true);
    document.execCommand = execCommand;

    await expect(copyTextToClipboard('')).resolves.toBe(false);
    expect(execCommand).not.toHaveBeenCalled();
  });
});
