// frontend/src/features/viewer/renderers/PdfView.jsx
// Fase V-2 (6.2): PDF num <iframe> (o Safari e o Chrome têm leitor nativo),
// com ↗ Abrir e ⤓ Baixar SEMPRE visíveis acima dele.
//
// Por que os botões não ficam só na barra: o Safari do iPad desenha um PDF
// dentro de iframe como imagem da PRIMEIRA PÁGINA, sem rolar. Para ler o resto
// é preciso abrir no leitor do navegador (↗) ou salvar (⤓) — e quem está
// olhando o PDF precisa ver isso ali, não adivinhar.
//
// Sem `sandbox` aqui de propósito: o leitor de PDF do Chrome não renderiza
// documento sandboxed, e o backend também não manda o CSP sandbox para PDF
// (6.10.2, item 4). Um PDF não roda script da página.
import { fileUrl } from '../viewerApi.js';
import { basenameOf } from '../viewerPaths.js';

export function PdfView({ item }) {
  const name = basenameOf(item.path);
  return (
    <>
      <div className="vw-subbar">
        <span>No iPad o PDF aqui pode mostrar só a 1ª página.</span>
        <div style={{ display: 'flex', gap: '6px' }}>
          <a className="vw-btn" href={fileUrl(item)} target="_blank" rel="noopener noreferrer">↗ Abrir</a>
          <a className="vw-btn vw-btn--primary" href={fileUrl(item, item.path, { download: true })} download={name}>⤓ Baixar</a>
        </div>
      </div>
      <iframe
        key={`${item.id}:${item.updated_at}`}
        className="vw-iframe"
        title={`PDF ${name}`}
        src={fileUrl(item, item.path, { version: item.updated_at })}
        data-testid="viewer-pdf-iframe"
      />
    </>
  );
}
