// frontend/src/components/AgentForm.test.jsx
// Cobertura do FORMULÁRIO em si, isolado do seu caller
// (layouts/v2/ConfiguracaoV2.jsx): validação de campos obrigatórios, erro
// inline, modo edição (id pré-preenchido e desabilitado) e o parse de
// "CHAVE=valor" do campo de env.
//
// `onSubmit` aqui é sempre um spy simples — quem decide entre
// createAgent(payload) e updateAgent(id, payload) é o caller, e isso é
// coberto nos testes de cada caller, não aqui.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { AgentForm } from './AgentForm.jsx';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// React 18 rastreia o valor do input por um setter próprio; escrever via o
// setter nativo + disparar 'input' é o que garante que o onChange controlado
// enxergue o valor novo.
function setInputValue(input, value) {
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  nativeSetter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function setTextareaValue(el, value) {
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  nativeSetter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function renderForm(overrides = {}) {
  const props = { agent: null, onCancel: vi.fn(), onSaved: vi.fn(), onSubmit: vi.fn().mockResolvedValue({}), ...overrides };
  render(<AgentForm {...props} />);
  return props;
}

describe('AgentForm — criação', () => {
  it('splits the command field by whitespace and submits the full payload', async () => {
    const { onSubmit, onSaved } = renderForm();

    setInputValue(screen.getByLabelText('ID'), 'claude-work');
    setInputValue(screen.getByLabelText('Nome'), 'Claude (Work)');
    setInputValue(screen.getByLabelText('Papel'), 'Assistente');
    setInputValue(screen.getByLabelText('Comando'), 'claude --settings ~/.claude-work');

    fireEvent.click(screen.getByText('Salvar'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({
      id: 'claude-work', nome: 'Claude (Work)', papel: 'Assistente', ia: 'claude',
      cmd: ['claude', '--settings', '~/.claude-work'], env: {},
    }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('blocks submit with an inline error when the command field is empty', async () => {
    const { onSubmit } = renderForm();

    setInputValue(screen.getByLabelText('ID'), 'claude-work');
    setInputValue(screen.getByLabelText('Nome'), 'Claude (Work)');
    setInputValue(screen.getByLabelText('Papel'), 'Assistente');

    fireEvent.click(screen.getByText('Salvar'));

    await waitFor(() => expect(screen.getByText(/Preencha id, nome, papel e comando/)).not.toBeNull());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('blocks submit when only whitespace was typed into a required field', async () => {
    const { onSubmit } = renderForm();

    setInputValue(screen.getByLabelText('ID'), '   ');
    setInputValue(screen.getByLabelText('Nome'), 'Claude');
    setInputValue(screen.getByLabelText('Papel'), 'Assistente');
    setInputValue(screen.getByLabelText('Comando'), 'claude');

    fireEvent.click(screen.getByText('Salvar'));

    await waitFor(() => expect(screen.getByText(/Preencha id, nome, papel e comando/)).not.toBeNull());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('allows selecting "terminal" as the ia and submits it unmodified', async () => {
    const { onSubmit } = renderForm();

    setInputValue(screen.getByLabelText('ID'), 'terminal-1');
    setInputValue(screen.getByLabelText('Nome'), 'Terminal');
    setInputValue(screen.getByLabelText('Papel'), 'Terminal puro');
    fireEvent.change(screen.getByLabelText('IA'), { target: { value: 'terminal' } });
    setInputValue(screen.getByLabelText('Comando'), 'powershell');

    fireEvent.click(screen.getByText('Salvar'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({
      id: 'terminal-1', nome: 'Terminal', papel: 'Terminal puro', ia: 'terminal',
      cmd: ['powershell'], env: {},
    }));
  });

  it('allows selecting "codex" as the ia and submits it unmodified', async () => {
    const { onSubmit } = renderForm();

    setInputValue(screen.getByLabelText('ID'), 'codex-1');
    setInputValue(screen.getByLabelText('Nome'), 'Codex');
    setInputValue(screen.getByLabelText('Papel'), 'Assistente');
    fireEvent.change(screen.getByLabelText('IA'), { target: { value: 'codex' } });
    setInputValue(screen.getByLabelText('Comando'), 'codex');

    fireEvent.click(screen.getByText('Salvar'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({
      id: 'codex-1', nome: 'Codex', papel: 'Assistente', ia: 'codex',
      cmd: ['codex'], env: {},
    }));
  });

  it('surfaces the rejection message inline and does not call onSaved when onSubmit fails', async () => {
    const { onSubmit, onSaved } = renderForm({
      onSubmit: vi.fn().mockRejectedValue(new Error('Já existe um agente com esse id')),
    });

    setInputValue(screen.getByLabelText('ID'), 'claude');
    setInputValue(screen.getByLabelText('Nome'), 'Claude');
    setInputValue(screen.getByLabelText('Papel'), 'Assistente');
    setInputValue(screen.getByLabelText('Comando'), 'claude');

    fireEvent.click(screen.getByText('Salvar'));

    await waitFor(() => expect(screen.getByText('Já existe um agente com esse id')).not.toBeNull());
    expect(onSubmit).toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe('AgentForm — parse de "CHAVE=valor" no campo de env', () => {
  it('turns one KEY=VALUE per line into the dict the backend expects', async () => {
    const { onSubmit } = renderForm();

    setInputValue(screen.getByLabelText('ID'), 'claude-work');
    setInputValue(screen.getByLabelText('Nome'), 'Claude (Work)');
    setInputValue(screen.getByLabelText('Papel'), 'Assistente');
    setInputValue(screen.getByLabelText('Comando'), 'claude');
    setTextareaValue(
      screen.getByLabelText('Variáveis de ambiente'),
      'CLAUDE_CONFIG_DIR=/home/bruno/.claude-work\nFOO=bar'
    );

    fireEvent.click(screen.getByText('Salvar'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      env: { CLAUDE_CONFIG_DIR: '/home/bruno/.claude-work', FOO: 'bar' },
    })));
  });

  it('ignores blank lines and lines without "=", and keeps "=" inside the value', async () => {
    const { onSubmit } = renderForm();

    setInputValue(screen.getByLabelText('ID'), 'claude-work');
    setInputValue(screen.getByLabelText('Nome'), 'Claude (Work)');
    setInputValue(screen.getByLabelText('Papel'), 'Assistente');
    setInputValue(screen.getByLabelText('Comando'), 'claude');
    setTextareaValue(
      screen.getByLabelText('Variáveis de ambiente'),
      '\nlixo sem igual\n  FOO = bar  \nQUERY=a=b\n=semChave\n'
    );

    fireEvent.click(screen.getByText('Salvar'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      env: { FOO: 'bar', QUERY: 'a=b' },
    })));
  });
});

describe('AgentForm — edição', () => {
  const existingAgent = {
    id: 'claude-work',
    nome: 'Claude (Work)',
    papel: 'Assistente',
    ia: 'claude',
    cmd: ['claude', '--settings', '~/.claude-work'],
    env: { FOO: 'bar' },
  };

  it('pre-fills every field from the agent and disables the ID', () => {
    renderForm({ agent: existingAgent });

    const idInput = screen.getByLabelText('ID');
    expect(idInput.value).toBe('claude-work');
    expect(idInput.disabled).toBe(true);
    expect(screen.getByLabelText('Nome').value).toBe('Claude (Work)');
    expect(screen.getByLabelText('Papel').value).toBe('Assistente');
    expect(screen.getByLabelText('IA').value).toBe('claude');
    expect(screen.getByLabelText('Comando').value).toBe('claude --settings ~/.claude-work');
    expect(screen.getByLabelText('Variáveis de ambiente').value).toBe('FOO=bar');
  });

  it('submits the original (disabled) id together with the edited fields', async () => {
    const { onSubmit } = renderForm({ agent: existingAgent });

    setInputValue(screen.getByLabelText('Nome'), 'Claude Work 2');
    fireEvent.click(screen.getByText('Salvar'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({
      id: 'claude-work', nome: 'Claude Work 2', papel: 'Assistente', ia: 'claude',
      cmd: ['claude', '--settings', '~/.claude-work'], env: { FOO: 'bar' },
    }));
  });
});

describe('AgentForm — cancelar', () => {
  it('calls onCancel without submitting anything', () => {
    const { onCancel, onSubmit } = renderForm();
    fireEvent.click(screen.getByText('Cancelar'));
    expect(onCancel).toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
