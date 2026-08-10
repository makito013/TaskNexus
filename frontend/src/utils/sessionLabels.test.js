// frontend/src/utils/sessionLabels.test.js
import { describe, it, expect } from 'vitest';
import { tabLabels } from './sessionLabels.js';

const claudeAgent = { id: 'claude', nome: 'Claude', ia: 'claude' };

describe('tabLabels', () => {
  it('falls back to positional default when no display_name is set', () => {
    const result = tabLabels(
      [{ sessionKey: 'p::claude', projectId: 'p', agentId: 'claude' }],
      () => claudeAgent,
    );
    expect(result[0].label).toBe('Claude');
  });

  it('numbers positional defaults per project+agent when there is no custom name', () => {
    const result = tabLabels(
      [
        { sessionKey: 'p::claude', projectId: 'p', agentId: 'claude' },
        { sessionKey: 'p::claude::x1', projectId: 'p', agentId: 'claude' },
      ],
      () => claudeAgent,
    );
    expect(result[0].label).toBe('Claude');
    expect(result[1].label).toBe('Claude 2');
  });

  it('prefers display_name over the positional default (D-08)', () => {
    const result = tabLabels(
      [{ sessionKey: 'p::claude', projectId: 'p', agentId: 'claude', display_name: 'Ecom Principal' }],
      () => claudeAgent,
    );
    expect(result[0].label).toBe('Ecom Principal');
  });

  it('treats a whitespace-only display_name as absent (falls back to positional default)', () => {
    const result = tabLabels(
      [{ sessionKey: 'p::claude', projectId: 'p', agentId: 'claude', display_name: '   ' }],
      () => claudeAgent,
    );
    expect(result[0].label).toBe('Claude');
  });

  it('a custom name does not affect numbering of sibling sessions without one', () => {
    const result = tabLabels(
      [
        { sessionKey: 'p::claude', projectId: 'p', agentId: 'claude', display_name: 'Ecom Principal' },
        { sessionKey: 'p::claude::x1', projectId: 'p', agentId: 'claude' },
      ],
      () => claudeAgent,
    );
    expect(result[0].label).toBe('Ecom Principal');
    expect(result[1].label).toBe('Claude 2');
  });
});
