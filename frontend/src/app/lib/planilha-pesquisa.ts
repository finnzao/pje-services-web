import type { SearchCriteria, SearchResultRow } from '../componentes/pje-download/types';

export interface PesquisaProgress {
  phase: 'initializing' | 'listing' | 'collecting' | 'finalizing' | 'cancelling' | 'done' | 'error' | 'cancelled';
  total: number;
  collected: number;
  message: string;
  rows: SearchResultRow[];
}

export type PesquisaProgressCallback = (progress: PesquisaProgress) => void;

export interface PlanilhaPesquisaParams {
  apiBase: string;
  sessionId: string;
  criteria: SearchCriteria;
}

const COLUNAS = [
  'Processo',
  'Órgão julgador',
  'Autuado em',
  'Classe judicial',
  'Polo ativo',
  'Polo passivo',
  'Nó(s) atual(is)',
  'Última movimentação',
];

function resolveBaseUrl(apiBase: string): string {
  if (apiBase) return apiBase;
  const envBase = typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_API_URL : undefined;
  if (envBase) return envBase;
  if (typeof window !== 'undefined') return window.location.origin;
  return '';
}

function escapeXml(value: string): string {
  return (value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ' ');
}

function colRef(col: number): string {
  let s = '';
  let n = col + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function cellXml(col: number, rowNum: number, value: string, bold: boolean): string {
  const ref = `${colRef(col)}${rowNum}`;
  const style = bold ? ' s="1"' : '';
  return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function rowXml(rowNum: number, values: string[], bold: boolean): string {
  const cells = values.map((v, i) => cellXml(i, rowNum, v, bold)).join('');
  return `<row r="${rowNum}">${cells}</row>`;
}

function buildSheetXml(rows: SearchResultRow[]): string {
  const lines: string[] = [];
  lines.push(rowXml(1, COLUNAS, true));
  rows.forEach((r, idx) => {
    lines.push(rowXml(idx + 2, [
      r.numeroProcesso,
      r.orgaoJulgador,
      r.autuadoEm,
      r.classeJudicial,
      r.poloAtivo,
      r.poloPassivo,
      r.noAtual,
      r.ultimaMovimentacao,
    ], false));
  });
  const lastCol = colRef(COLUNAS.length - 1);
  const dimension = `A1:${lastCol}${rows.length + 1}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<dimension ref="${dimension}"/>
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>
<col min="1" max="1" width="28" customWidth="1"/>
<col min="2" max="2" width="34" customWidth="1"/>
<col min="3" max="3" width="14" customWidth="1"/>
<col min="4" max="4" width="26" customWidth="1"/>
<col min="5" max="5" width="32" customWidth="1"/>
<col min="6" max="6" width="32" customWidth="1"/>
<col min="7" max="7" width="44" customWidth="1"/>
<col min="8" max="8" width="40" customWidth="1"/>
</cols>
<sheetData>
${lines.join('\n')}
</sheetData>
<autoFilter ref="${dimension}"/>
</worksheet>`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const WORKBOOK_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Pesquisa Geral" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF182742"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment vertical="center"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
<dxfs count="0"/>
<tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>`;

export async function gerarPlanilhaBlob(rows: SearchResultRow[]): Promise<Blob> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES);
  zip.folder('_rels')!.file('.rels', ROOT_RELS);
  const xl = zip.folder('xl')!;
  xl.file('workbook.xml', WORKBOOK_XML);
  xl.file('styles.xml', STYLES_XML);
  xl.folder('_rels')!.file('workbook.xml.rels', WORKBOOK_RELS);
  xl.folder('worksheets')!.file('sheet1.xml', buildSheetXml(rows));
  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    compression: 'DEFLATE',
  });
}

function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function stamp(): string {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}_${p(now.getHours())}h${p(now.getMinutes())}`;
}

export class PlanilhaPesquisaManager {
  private es: EventSource | null = null;
  private cancelRequested = false;
  private serverCancelled = false;
  private settled = false;
  private rows: SearchResultRow[] = [];
  private streamId: string | null = null;
  private apiBaseResolved = '';

  get isRunning(): boolean { return this.es !== null; }

  async cancel(): Promise<void> {
    if (this.cancelRequested) return;
    this.cancelRequested = true;
    if (this.streamId) {
      try {
        await fetch(`${this.apiBaseResolved}/api/pje/downloads/stream-batch/${this.streamId}/cancel`, {
          method: 'POST',
          keepalive: true,
        });
      } catch {  }
    }
  }

  execute(params: PlanilhaPesquisaParams, onProgress: PesquisaProgressCallback): Promise<void> {
    this.cancelRequested = false;
    this.serverCancelled = false;
    this.settled = false;
    this.rows = [];
    this.streamId = null;
    this.apiBaseResolved = resolveBaseUrl(params.apiBase);

    const progress: PesquisaProgress = {
      phase: 'initializing',
      total: 0,
      collected: 0,
      message: 'Iniciando pesquisa...',
      rows: this.rows,
    };
    onProgress({ ...progress, rows: [...this.rows] });

    return new Promise((resolve, reject) => {
      const base = this.apiBaseResolved;
      const url = new URL(`${base}/api/pje/downloads/search-sheet-stream`);
      url.searchParams.set('sessionId', params.sessionId);
      url.searchParams.set('criteria', JSON.stringify(params.criteria));

      const es = new EventSource(url.toString());
      this.es = es;

      const close = () => { if (this.es) { this.es.close(); this.es = null; } };

      es.addEventListener('init', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          if (data?.streamId) this.streamId = data.streamId;
        } catch {  }
      });

      es.addEventListener('listing', (e: MessageEvent) => {
        const data = JSON.parse(e.data);
        progress.phase = this.cancelRequested ? 'cancelling' : 'collecting';
        progress.total = data.total;
        progress.message = this.cancelRequested
          ? 'Cancelando — aguardando o servidor interromper...'
          : `${data.total} processo(s) encontrado(s). Coletando "Nó(s) atual(is)"...`;
        onProgress({ ...progress, rows: [...this.rows] });
      });

      es.addEventListener('row', (e: MessageEvent) => {
        const data = JSON.parse(e.data) as SearchResultRow & { index: number; total: number };
        this.rows.push({
          numeroProcesso: data.numeroProcesso,
          orgaoJulgador: data.orgaoJulgador,
          autuadoEm: data.autuadoEm,
          classeJudicial: data.classeJudicial,
          poloAtivo: data.poloAtivo,
          poloPassivo: data.poloPassivo,
          noAtual: data.noAtual,
          ultimaMovimentacao: data.ultimaMovimentacao,
        });
        progress.collected = this.rows.length;
        progress.total = data.total || progress.total;
        if (!this.cancelRequested) {
          progress.message = `Coletando ${this.rows.length}/${progress.total}: ${data.numeroProcesso}`;
        }
        onProgress({ ...progress, rows: [...this.rows] });
      });

      es.addEventListener('cancelled', () => {
        this.serverCancelled = true;
        progress.phase = 'cancelling';
        progress.message = 'Cancelamento confirmado pelo servidor. Finalizando...';
        onProgress({ ...progress, rows: [...this.rows] });
      });

      es.addEventListener('done', async (e: MessageEvent) => {
        if (this.settled) return;
        this.settled = true;
        try { const d = JSON.parse(e.data); if (d?.cancelled) this.serverCancelled = true; } catch {  }
        close();

        if (this.serverCancelled) {
          progress.phase = 'cancelled';
          progress.message = `Pesquisa cancelada pelo usuário (${this.rows.length} processo(s) coletado(s)).`;
          onProgress({ ...progress, rows: [...this.rows] });
          resolve();
          return;
        }

        try {
          progress.phase = 'finalizing';
          progress.message = 'Gerando planilha...';
          onProgress({ ...progress, rows: [...this.rows] });

          if (this.rows.length > 0) {
            const blob = await gerarPlanilhaBlob(this.rows);
            triggerDownload(blob, `Pesquisa_Geral_${stamp()}.xlsx`);
          }

          progress.phase = 'done';
          progress.message = this.rows.length > 0
            ? `Planilha gerada: ${this.rows.length} processo(s).`
            : 'Nenhum processo encontrado para os critérios informados.';
          onProgress({ ...progress, rows: [...this.rows] });
          resolve();
        } catch (err) {
          progress.phase = 'error';
          progress.message = err instanceof Error ? err.message : 'Erro ao gerar planilha';
          onProgress({ ...progress, rows: [...this.rows] });
          reject(err instanceof Error ? err : new Error('Erro ao gerar planilha'));
        }
      });

      es.addEventListener('fatal', (e: MessageEvent) => {
        if (this.settled) return;
        this.settled = true;
        close();
        let message = 'Erro na pesquisa';
        try { message = JSON.parse(e.data).message || message; } catch {  }
        progress.phase = 'error';
        progress.message = message;
        onProgress({ ...progress, rows: [...this.rows] });
        reject(new Error(message));
      });

      es.onerror = () => {
        if (this.settled) return;
        this.settled = true;
        close();
        if (this.cancelRequested) {
          progress.phase = 'cancelled';
          progress.message = `Pesquisa cancelada (${this.rows.length} processo(s) coletado(s)).`;
          onProgress({ ...progress, rows: [...this.rows] });
          resolve();
          return;
        }
        progress.phase = 'error';
        progress.message = 'Falha na conexão com o servidor.';
        onProgress({ ...progress, rows: [...this.rows] });
        reject(new Error('Falha na conexão SSE'));
      };
    });
  }
}
