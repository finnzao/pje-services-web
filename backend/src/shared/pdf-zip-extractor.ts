import * as fs from 'node:fs';
import * as path from 'node:path';
import JSZip from 'jszip';
import type { PJEDownloadedFile } from './types';

const PDF_EXT_RE = /\.pdf$/i;
const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;
// Acima deste tamanho não tentamos abrir o ZIP em memória — grava o .zip como está.
const MAX_ZIP_EXTRACT_BYTES = 200 * 1024 * 1024; // 200 MB

/**
 * Identifica o tipo real do buffer pelos primeiros bytes (magic number),
 * independentemente da extensão do nome — o PJE entrega `.pdf` ou `.zip`.
 *   %PDF        → pdf
 *   PK\x03\x04  → zip (aceita também marcadores de ZIP vazio/spanned)
 */
function sniffKind(buf: Buffer): 'pdf' | 'zip' | 'other' {
  if (buf.length >= 4) {
    if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return 'pdf';
    if (
      buf[0] === 0x50 && buf[1] === 0x4b &&
      (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07)
    ) {
      return 'zip';
    }
  }
  return 'other';
}

function sanitizeFileName(name: string): string {
  return name.replace(INVALID_FILENAME_CHARS, '_').replace(/\s+/g, '_').replace(/_{2,}/g, '_');
}

/**
 * Grava no disco o conteúdo baixado do S3 do PJE, tratando ZIP x PDF.
 *
 * - PDF  → grava `<numero>-processo.pdf` (comportamento original preservado).
 * - ZIP  → tenta extrair os PDFs internos:
 *      • 1 PDF  → `<numero>-processo.pdf`
 *      • N PDFs → `<numero>-processo__<nomeInterno>` (um arquivo por volume)
 *      • 0 PDFs ou falha ao abrir → mantém o ZIP inteiro (`<numero>-processo.zip`)
 * - Outro → grava como `.pdf` (mantém o fluxo anterior, sem quebrar nada).
 *
 * Retorna SEMPRE a lista de arquivos efetivamente gravados (1..N).
 */
export async function writePjeDownload(
  buffer: Buffer,
  numeroProcesso: string,
  downloadDir: string,
): Promise<PJEDownloadedFile[]> {
  if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

  const baseName = `${numeroProcesso}-processo`;

  const writeOne = (fileName: string, buf: Buffer): PJEDownloadedFile => {
    const filePath = path.join(downloadDir, fileName);
    fs.writeFileSync(filePath, buf);
    return {
      processNumber: numeroProcesso,
      fileName,
      filePath,
      fileSize: buf.length,
      downloadedAt: new Date().toISOString(),
    };
  };

  const kind = sniffKind(buffer);

  if (kind !== 'zip') {
    return [writeOne(`${baseName}.pdf`, buffer)];
  }

  // ZIP muito grande: grava inteiro sem abrir em memória (evita OOM no servidor).
  if (buffer.length > MAX_ZIP_EXTRACT_BYTES) {
    return [writeOne(`${baseName}.zip`, buffer)];
  }

  // É um ZIP — extrai os PDFs internos antes de empacotar.
  try {
    const zip = await JSZip.loadAsync(buffer);
    const pdfEntries = Object.values(zip.files).filter(
      (f) => !f.dir && PDF_EXT_RE.test(f.name),
    );

    if (pdfEntries.length === 0) {
      // Nenhum PDF dentro → mantém o ZIP inteiro.
      return [writeOne(`${baseName}.zip`, buffer)];
    }

    const out: PJEDownloadedFile[] = [];
    for (let i = 0; i < pdfEntries.length; i++) {
      const entry = pdfEntries[i];
      const pdfBuf = await entry.async('nodebuffer');
      const inner = entry.name.split('/').pop() || `parte_${i + 1}.pdf`;
      const fileName = pdfEntries.length === 1
        ? `${baseName}.pdf`
        : `${baseName}__${sanitizeFileName(inner)}`;
      out.push(writeOne(fileName, pdfBuf));
    }
    return out;
  } catch {
    // Falha ao abrir/extrair → salva o ZIP como está (fallback seguro).
    return [writeOne(`${baseName}.zip`, buffer)];
  }
}
