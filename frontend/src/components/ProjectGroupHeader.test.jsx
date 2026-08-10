// frontend/src/components/ProjectGroupHeader.test.jsx
//
// Cobre 05-TL.md Tarefa 14: o componente é genérico o bastante para servir
// tanto ao Board ("N cards") quanto a Tarefas ("N pendentes") sem hardcodar
// nenhum dos dois textos, o chevron reflete `collapsed`, e o cabeçalho
// inteiro (chevron + nome + contagem) é um único alvo de clique.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ProjectGroupHeader } from './ProjectGroupHeader.jsx';

afterEach(() => cleanup());

describe('ProjectGroupHeader — label e contagem genérica', () => {
  it('renderiza label e "count countLabel" no formato do Board (ex: "3 cards")', () => {
    render(
      <ProjectGroupHeader label="podesubir" count={3} countLabel="cards" collapsed={false} onToggle={vi.fn()} />
    );

    expect(screen.getByText('podesubir')).not.toBeNull();
    expect(screen.getByText('3 cards')).not.toBeNull();
  });

  it('renderiza a mesma contagem com outro countLabel, sem hardcode ("5 pendentes")', () => {
    render(
      <ProjectGroupHeader label="escritorio-agentes" count={5} countLabel="pendentes" collapsed={false} onToggle={vi.fn()} />
    );

    expect(screen.getByText('escritorio-agentes')).not.toBeNull();
    expect(screen.getByText('5 pendentes')).not.toBeNull();
    // nenhum dos textos hardcoded do outro consumidor vaza aqui
    expect(screen.queryByText('5 cards')).toBeNull();
  });

  it('aceita label livre, ex: "Projeto desconhecido (slug)"', () => {
    render(
      <ProjectGroupHeader label="Projeto desconhecido (slug)" count={2} countLabel="pendentes" collapsed={false} onToggle={vi.fn()} />
    );

    expect(screen.getByText('Projeto desconhecido (slug)')).not.toBeNull();
  });
});

describe('ProjectGroupHeader — chevron reflete collapsed', () => {
  it('mostra ▾ quando expandido (collapsed=false)', () => {
    render(<ProjectGroupHeader label="p" count={1} countLabel="cards" collapsed={false} onToggle={vi.fn()} />);
    expect(screen.getByText('▾')).not.toBeNull();
    expect(screen.queryByText('▸')).toBeNull();
  });

  it('mostra ▸ quando colapsado (collapsed=true)', () => {
    render(<ProjectGroupHeader label="p" count={1} countLabel="cards" collapsed={true} onToggle={vi.fn()} />);
    expect(screen.getByText('▸')).not.toBeNull();
    expect(screen.queryByText('▾')).toBeNull();
  });
});

describe('ProjectGroupHeader — clique dispara onToggle', () => {
  it('chama onToggle exatamente uma vez ao clicar no nome', () => {
    const onToggle = vi.fn();
    render(<ProjectGroupHeader label="podesubir" count={3} countLabel="cards" collapsed={false} onToggle={onToggle} />);

    fireEvent.click(screen.getByText('podesubir'));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('chama onToggle exatamente uma vez ao clicar no chevron', () => {
    const onToggle = vi.fn();
    render(<ProjectGroupHeader label="podesubir" count={3} countLabel="cards" collapsed={false} onToggle={onToggle} />);

    fireEvent.click(screen.getByText('▾'));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('chama onToggle exatamente uma vez ao clicar na contagem', () => {
    const onToggle = vi.fn();
    render(<ProjectGroupHeader label="podesubir" count={3} countLabel="cards" collapsed={false} onToggle={onToggle} />);

    fireEvent.click(screen.getByText('3 cards'));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
