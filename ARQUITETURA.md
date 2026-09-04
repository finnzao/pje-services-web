# Arquitetura do Fórum Hub

> Referência técnica da aplicação de automação do PJE/TJBA: download de autos processuais em lote,
> geração de planilhas de advogados, pesquisa geral de processos e planilha administrativa por dígito.
> Atualizado em **04/09/2026**; limpeza de código legado descrita na [§13](#13--higiene-de-código-limpeza-de-082026).

**Stack:** Fastify 5 · Node 20 · Next.js 16 · React 19 · TypeScript strict · pnpm workspace · SSE + File System Access API

---

## Sumário

1. [Visão geral](#1--visão-geral)
2. [Stack e repositório](#2--stack-e-repositório)
3. [Topologia](#3--topologia)
4. [Autenticação e sessões](#4--autenticação-e-sessões)
5. [Download de processos (fluxo SSE)](#5--download-de-processos-fluxo-sse)
6. [Armazenamento no cliente](#6--armazenamento-no-cliente)
7. [Planilha de advogados](#7--planilha-de-advogados)
8. [Planilha administrativa por dígito](#8--planilha-administrativa-por-dígito)
9. [Pesquisa geral](#9--pesquisa-geral)
10. [Contratos de API](#10--contratos-de-api)
11. [Constantes e limites](#11--constantes-e-limites-operacionais)
12. [Segurança e pontos de atenção](#12--segurança-e-pontos-de-atenção)
13. [Higiene de código (limpeza de 08/2026)](#13--higiene-de-código-limpeza-de-082026)
14. [Build, execução e deploy](#14--build-execução-e-deploy)

---

## 1 · Visão geral

O Fórum Hub é uma aplicação interna que automatiza quatro serviços sobre o **PJE do Tribunal de
Justiça da Bahia (1º grau)**:

- **Download de Processos** — baixa os autos digitais (PDF/ZIP) de todos os processos de uma ou
  mais tarefas, etiquetas, lista de números CNJ ou resultado de pesquisa, com filtro opcional por
  tipo de documento.
- **Planilha de Advogados** — extrai advogados (nome, OAB, CPF) dos polos ativo/passivo de cada
  processo e gera um `.xlsx` multi-abas com filtros por nome ou OAB.
- **Pesquisa Geral** — usa a Consulta Processual pública do PJE para gerar planilhas de resultados
  (com a coluna "Nó(s) atual(is)") ou baixar os processos encontrados, inclusive em *fila*
  (vários nomes de parte processados em sequência).
- **Planilha Administrativa por Dígito** — distribui o acervo da unidade entre servidores pelo
  último dígito do sequencial CNJ e entrega a carga de cada um ordenada por prioridade de
  trabalho (metas do BI, tempo morto, antiguidade), em `.xlsx` único ou `.zip` por servidor.

A decisão de arquitetura central: **o backend não armazena os arquivos do fluxo principal**. Ele
atua como um proxy de autenticação e scraping que descobre URLs assinadas de download (S3 do PJE)
e as transmite por **Server-Sent Events**; é o **navegador** que baixa cada PDF (via proxy de
streaming ou direto do S3) e o grava numa pasta local (File System Access API) ou monta um ZIP —
com suporte a ZIP64 em streaming para lotes acima de 1 GiB. Não há banco de dados: todo estado
vive em memória, com um snapshot de sessões em arquivo JSON.

**Como o PJE é consumido** (não existe API oficial):

1. **SSO Keycloak** (`sso.cloud.pje.jus.br`) para login com CPF/senha e 2FA;
2. **REST legada** (`/pje/seam/resource/rest/pje-legacy`) para painel do usuário, tarefas,
   etiquetas e área de download;
3. **Scraping das telas JSF/RichFaces** (`listAutosDigitais.seam`, `listView.seam`, `dev.seam`)
   com manipulação manual de `ViewState`, ids `j_idNN` e requisições `AJAXREQUEST`.

## 2 · Stack e repositório

Monorepo `pnpm` com dois aplicativos independentes (instalação e deploy separados):

| App | Tecnologias | Papel |
| --- | --- | --- |
| `backend/` | Fastify 5, TypeScript (CommonJS, target ES2022), pino, ExcelJS, JSZip, tsx (dev) | API REST + SSE; proxy de autenticação e scraping do PJE; geração das planilhas de advogados e por dígito no servidor |
| `frontend/` | Next.js 16.1.6 (App Router), React 19.2.3, Tailwind CSS v4, lucide-react, JSZip (só como empacotador) | SPA de página única (`/pje/pje-download`); orquestra downloads no navegador e gera XLSX de pesquisa no cliente |

- **Node 20+**, `pnpm@10.28.2` fixado via `packageManager`/Corepack.
- Raiz: `pnpm dev` sobe API e web juntos via `concurrently`.
- Identidade visual: Fraunces (display), IBM Plex Sans (texto), IBM Plex Mono (dados), paleta
  *navy/brass* declarada em `@theme` no `globals.css` (Tailwind v4, sem `tailwind.config`).
- Backend: `tsc` → `dist/`; Vitest em `src/__tests__` (funções puras da planilha por dígito).
- Frontend: `next.config.ts` define apenas *rewrites* de `/api/*` → `NEXT_PUBLIC_API_URL`
  (necessário porque `EventSource` não envia headers customizados).

## 3 · Topologia

```
┌───────────────────────────┐      ┌───────────────────────────────┐      ┌─────────────────────────┐
│         Navegador         │      │            Backend            │      │        PJE / TJBA       │
│   Next.js 16 (client)     │      │      Fastify 5 (sem BD)       │      │    sistemas externos    │
├───────────────────────────┤      ├───────────────────────────────┤      ├─────────────────────────┤
│ page.tsx (wizard)         │ ⇄   │ auth.controller               │ ⇄   │ SSO Keycloak            │
│  · sessão em localStorage │      │  · login, 2FA, perfis         │      │  · CPF/senha, OTP       │
│    pje_sessao_v1          │      │ stream.controller (SSE)       │      │ REST pje-legacy         │
│ DownloadManager           │      │  · /stream-batch              │      │  · painelUsuario/*      │
│  · semáforo 3, sniff,     │      │  · /search-sheet-stream       │      │  · pjedocs-api          │
│    relatório TXT          │      │ proxy.controller              │      │ Telas JSF/RichFaces     │
│ FileSystemManager         │      │  · streaming S3, token único  │      │  · listAutosDigitais    │
│  · FS API ou ZIP64        │      │ advogados (job 202 + polling) │      │  · listView, dev.seam   │
│ PlanilhaPesquisaManager   │      │ sessionStore                  │      │ S3 do PJE               │
│  · XLSX no cliente        │      │  · Map + .pje-sessions.json   │      │  · URLs assinadas       │
└───────────────────────────┘      └───────────────────────────────┘      └─────────────────────────┘
```

Deploy de referência: backend no **Render** (`render.yaml`, health-check em `/api/health`) e
frontend no **Vercel** (`pje-services-web-frontend.vercel.app`, único origin liberado no CORS em
produção).

## 4 · Autenticação e sessões

### 4.1 · Login no PJE (`PJEAuthProxy`)

1. **Reuso por CPF** — se existe sessão persistida do CPF (TTL 4 h), importa os cookies e valida
   com `usuario/currentUser`; válida → retorna direto com perfis, sem novo login.
2. **Login fresco** — `GET /pje/login.seam` seguindo até 25 redirects manualmente
   (`PJEHttpClient.followRedirects`, com detecção de loop PJE↔SSO e preservação de `;jsessionid`
   como cookie). Cai no formulário Keycloak (`kc-form-login`); os campos são extraídos por regex e
   o POST leva usuário/senha. Até 4 tentativas com limpeza de cookies e espera de 3 s quando o SSO
   "devolve" o formulário sem erro explícito.
3. **2FA** — detectado apenas se a URL final ainda está no SSO (`detect2FA`). O HTML do desafio é
   guardado na sessão (`ssoHtml`) para reconstruir o form no `submit2FA`: código de 6 dígitos no
   campo `otp|code`, parâmetros Keycloak (`session_code`, `execution`, `client_id`, `tab_id`)
   reinjetados, e `login: 'Validar'` quando TOTP. Código rejeitado devolve HTTP 200 com
   `needs2FA: true` — o mesmo `sessionId` aceita nova tentativa.
4. **Validação** — em URL logada, `usuario/currentUser` confirma o `idUsuario` e captura
   `idUsuarioLocalizacao`; a sessão é gravada no `sessionStore` e persistida por CPF.
5. **Seleção de perfil** — scraping de `/pje/ng2/dev.seam` (tabela `papeisUsuarioForm:dtPerfil`,
   5 perfis por página com paginação AJAX RichFaces). O favorito do `<thead>` tem índice `-1`;
   a seleção posta o id JSF do link (`j_id70`/`j_id68`/`j_id66`). Em seguida três POSTs em
   paralelo carregam `tarefas`, `tarefasFavoritas` e `etiquetas` (até 500).

### 4.2 · Camadas de sessão

| Camada | Onde | Chave | TTL | Observações |
| --- | --- | --- | --- | --- |
| Sessão de trabalho | `sessionStore` (backend, memória) | `sessionId` = `pje_{ts}_{rand36}` | 30 min deslizante | Cada `get()` renova; manutenção a cada 5 min revalida no PJE (keep-alive) e remove inválidas |
| Sessão por CPF | `cpfSessions` (backend) | CPF | 4 h | Permite relogin sem senha/2FA reutilizando cookies |
| Snapshot em disco | `.pje-sessions.json` | — | — | Debounce 500 ms; omite `ssoHtml`; recarregado no boot (sobrevive a restart) |
| Sessão da UI | `localStorage` (frontend) | `pje_sessao_v1` | — | Objeto `SessaoPJE` completo, **nunca a senha**; no F5 é revalidado por `GET /auth/validate-session` antes de reidratar o wizard |

### 4.3 · "Autenticação" da própria API

Não há JWT nem usuários reais. As rotas de *advogados* exigem o header `x-user` com um JSON
`{id, name, role}` e `role === 'magistrado'` — o frontend envia um valor fixo hardcoded. Em
desenvolvimento, a ausência do header injeta um usuário dev automaticamente. As rotas de auth,
stream e proxy não passam por esse middleware: a autorização efetiva é a posse de um `sessionId`
válido do PJE, transportado em query string (limitação do `EventSource`).

## 5 · Download de processos (fluxo SSE)

### 5.1 · Pré-voo de `GET /stream-batch`

Antes de virar SSE, a rota valida a sessão no PJE (`usuario/currentUser`) e aplica os limites de
concorrência: **1 stream por usuário** (chave = CPF) e **5 globais** (HTTP 429). Aprovada, a
resposta é sequestrada (`reply.hijack()`), os headers SSE são escritos (com
`X-Accel-Buffering: no` e heartbeat `: ping` a cada 15 s) e o evento `init {streamId}` abre o
canal — o `streamId` é o alvo do endpoint de cancelamento.

### 5.2 · Listagem — fontes múltiplas com deduplicação

Quatro estratégias (`UrlExtractor.listProcesses`) resolvem a lista de
`ProcessoInfo {idProcesso, numeroProcesso, idTaskInstance?}`:

| Modo | Fonte no PJE | Paginação |
| --- | --- | --- |
| `by_task` | `POST painelUsuario/recuperarProcessosTarefaPendenteComCriterios/{tarefa}/{fav}` | 500/pág (offset absoluto) · teto 10 000 |
| `by_tag` | `GET painelUsuario/etiquetas/{id}/processos` (+ `/total`) | 500/pág |
| `by_number` | Cascata: tarefas do painel → Consulta Pública → 4 endpoints REST de fallback | — |
| `by_search` | Consulta Pública JSF (`listView.seam`) — ver §9 | 20/pág · teto 1 000 |

**Seleção múltipla:** o parâmetro `taskNames` (JSON `[{name, isFavorite}]`) e o `tagIds` (CSV)
permitem enfileirar várias tarefas/etiquetas numa única execução; cada fonte é listada em série e
os lotes são mesclados com **dedup pelos dígitos do número CNJ** — processo presente em duas
tarefas é baixado uma vez. Os singulares `taskName`/`tagId` continuam aceitos como fallback.

### 5.3 · Tipos de documento — catálogo estático nome → ID

O frontend envia *nomes* (CSV em `documentTypes`); o backend os traduz por
`expandSelectedTypes` usando o catálogo hardcoded `TIPO_DOCUMENTO_VALUES` (~41 entradas, ex.:
`Petição→11`, `Despacho→63`, `INTIMAÇÃO→108`). Lista vazia (ou apenas nomes desconhecidos, que
são descartados com `console.warn`) degrada para o sentinela `Selecione` = processo inteiro. O
total de requisições é o produto *processos × tipos*. Antes do POST, `optionExistsInSelect`
confere se o `value` existe no `<select navbar:cbTipoDocumento>` do processo (fail-open se o
select não for encontrado) e retorna `not_available` sem requisição quando ausente.

> **Fragilidade conhecida:** os IDs do `cbTipoDocumento` *variam entre processos* no PJE/TJBA
> (ex.: há processos em que "Petição" é `value=36` e "PETIÇÃO" é `value=101`). Como o catálogo é
> fixo, tipos existentes podem ser reportados como `not_available` (falso negativo). A alternativa
> robusta é resolver o ID por *nome da option, processo a processo* (correspondência exata
> case-insensitive no HTML dos autos) — abordagem já prototipada neste repositório e revertida;
> fica registrada como decisão em aberto.

### 5.4 · Extração da URL por processo (JSF)

1. **Atalho "ready":** quando o pedido inclui o processo inteiro, uma pré-checagem em
   `pjedocs-api/v1/downloadService/recuperarDownloadsDisponiveis` mapeia CNJs já prontos na Área
   de Download; para esses, `gerar-url-download?hashDownload=…` devolve a URL S3 direto
   (`method:'ready'`), sem tocar no JSF.
2. `GET painelUsuario/gerarChaveAcessoProcesso/{idProcesso}` → chave `ca`.
3. `GET listAutosDigitais.seam?idProcesso&ca[&idTaskInstance]` → extrai
   `javax.faces.ViewState` e o id do botão Download (4 regex + heurística de contexto sobre
   `navbar:j_idNN`).
4. **POST AJAX** no mesmo `.seam` (`AJAXREQUEST=_viewRoot`, `Faces-Request: partial/ajax`) com
   `navbar:cbTipoDocumento = id | '0'`.
5. **Classificação da resposta:** URL S3 (`window.open('…s3….pdf|zip')`) → `direct` (+ `HEAD`
   para `fileSize`); frases "nenhum documento/sem documentos…" → `not_available`; "será
   disponibilizado/Área de download/…" ou resposta > 5 000 chars → `queued`; senão `error`.
6. **Fila de pendentes:** itens `queued` entram num polling da Área de Download (início 5 s,
   backoff 10 s + 2,5 s/rodada até 30 s, timeout 10 min), com casamento por número/ID/nome do
   arquivo e chave composta `digitos::tipo` (vários tipos do mesmo processo podem pender juntos).
   Lotes de 10 pendentes disparam a coleta em paralelo ao laço principal.

O laço percorre *processos × tipos* com `ParallelPool(3)` e stagger de 500 ms (200 ms nos
"ready"). Cada URL S3 é registrada no **proxy** (`registerProxyUrl` → token de 16 chars, uso
único, TTL 30 min, máx. 4 streams simultâneos) e emitida no evento `url` com `downloadUrl` +
`proxyUrl`.

### 5.5 · Lado do cliente (`DownloadManager`)

- Consome o SSE com `EventSource`; cada evento `url` agenda um download com **semáforo de 3**
  arquivos simultâneos — tenta o `proxyUrl` do backend e cai para a URL S3 direta
  (`mode: 'cors'`) em falha.
- **Sniff por magic number** (4 bytes): corrige a extensão real (`%PDF` → .pdf, `PK…` → .zip)
  independentemente do nome anunciado.
- Nomes: `{CNJ}[_{Tipo}].pdf`; pasta do lote `PJE_{rótulo}_{data}_{hora}`.
- Gera `_relatorio.txt` por lote (modo, fontes, critérios, tipos, contagens, erros,
  não-disponíveis, arquivos) — suprimível com `skipReport` (usado pela fila da Pesquisa Geral).
- **Cancelamento cooperativo:** `POST /stream-batch/{streamId}/cancel` e espera da confirmação
  (`cancelled`) — downloads em voo terminam e o parcial é preservado/empacotado.

## 6 · Armazenamento no cliente

`FileSystemManager` decide entre dois modos na inicialização:

- **`fsapi`** (Chrome/Edge): `showDirectoryPicker()` grava cada PDF direto na pasta escolhida, em
  subpasta por lote. A instância é *reutilizável* (init idempotente) — a fila da Pesquisa Geral
  compartilha um único manager para pedir a pasta uma só vez.
- **`zip`** (fallback): arquivos ficam em memória e o `finalize()` escolhe a estratégia por
  tamanho: até 1 GiB → blob; acima → `showSaveFilePicker` com escrita em streaming, ou **service
  worker** (`public/zip-sw.js`) que serve um `ReadableStream` interceptando um iframe oculto —
  permitindo ZIPs maiores que a RAM.

O empacotador (`lib/zip-stream.ts`) é uma implementação própria de ZIP em streaming com **ZIP64**
(data descriptors, EOCD64) e método *STORE* (sem compressão — PDFs já são comprimidos).
`redownloadZip()` permite baixar novamente o lote ao final, inclusive reempacotando a pasta no
modo fsapi.

## 7 · Planilha de advogados

Único serviço que roda inteiro no servidor. `POST /api/pje/advogados/gerar` responde
**202 {jobId}** imediatamente (fire-and-forget) e o frontend faz polling de `/progress` a cada
2,5 s até `completed|failed|cancelled`.

1. **Sessão:** prioriza `pjeSessionId` existente (por isso funciona após F5, sem senha em
   memória); fallback para login com credenciais + `pjeProfileIndex`.
2. **Listagem:** mesmas fontes do download, com suporte a **múltiplas tarefas** (`taskNames[]`) e
   **etiquetas** (`tagIds[]`), dedup global por `idProcesso`.
3. **Extração (10→90%):** 4 workers concorrentes (stagger 250 ms) abrem
   `listAutosDigitais.seam` de cada processo e o parser recorta as seções
   `#poloAtivo`/`#poloPassivo`, aceitando apenas âncoras com `%28ADVOGADO%29`/`%28DEFENSOR` no
   href (evita falsos positivos com partes). De cada span extrai nome, `OAB {UF}{número}` e CPF.
4. **Geração (92%):** ExcelJS grava `downloads/planilhas/advogados_pje_{ts}.xlsx` — aba
   **Geral** + uma aba por filtro (`nome` por substring sem acentos; `oab` por igualdade
   normalizada), cabeçalho congelado, autofiltro, status verde/vermelho por processo.
5. **Download:** `GET /:jobId/download` serve o `.xlsx` — atenção: devolve o arquivo *mais
   recente* do diretório, não o do jobId (race com jobs concorrentes).

## 8 · Planilha administrativa por dígito

Segundo serviço que roda inteiro no servidor, no mesmo contrato de job da planilha de advogados:
`POST /api/pje/planilha-digito/gerar` responde **202 {jobId}**, o frontend faz polling de
`/progress` a cada 2,5 s e baixa o arquivo em `/:jobId/download`. Distribui o acervo da unidade
entre servidores pelo **dígito de distribuição** — o último algarismo do sequencial `NNNNNNN` do
número CNJ (conceito que o próprio painel chama de `digitoFinalNumeroProcesso`), não o dígito
verificador `DD`.

**Entradas** (`GerarPlanilhaDigitoDTO`): atribuições dígito → servidor (um servidor pode acumular
vários dígitos; dígitos sem servidor caem em "Não atribuídos"), tarefas ignoradas
(multi-seleção) e formato (`.xlsx` único com uma aba por servidor, ou `.zip` com um arquivo por
servidor via `jszip`, readmitido no backend com esse consumidor). Pesos de priorização podem ser
sobrescritos pontualmente no DTO (`pesos`).

1. **Sessão e acervo:** `resolveSessionFromDto` (extraído de advogados, §7) resolve a sessão; o
   acervo é a união de **todas as tarefas do painel** (`painelUsuario/tarefas`) menos as
   ignoradas, listadas pela paginação compartilhada (`painel-listing.ts`, 500/pág) com **dedup
   pelos dígitos do número CNJ** — processo em mais de uma tarefa entra uma vez, com as demais
   tarefas anotadas na planilha. Da listagem saem tarefa atual, etiquetas (`tagsProcessoList`) e
   assunto.
2. **Dias parados (30→90%):** `GET processos/{id}/ultimoMovimento` por processo, com 4 workers e
   stagger de 250 ms (mesmo pool da extração de advogados). "Dias parados" = dias desde a
   **última movimentação** (não desde a chegada na tarefa); sem movimento disponível, cai para
   `dataChegada` com a flag `SEM_ULTIMO_MOVIMENTO`. Número malformado não derruba o lote: vira
   `NUMERO_MALFORMADO` em "Não atribuídos".
3. **Priorização por pesos** (`digito-core.ts`, calibrada pelo guia do Motor BI): etiqueta de
   meta mais pesada (saúde 40 > júri 35 > saneamento 30 > demais 20; prefixos `gab_meta`/
   `acv_meta`), tempo morto na régua CNJ de 100 dias (+25, escalando +5 a cada 30 dias, teto
   +25) e antiguidade Meta 2 (+2/ano, teto +20). Faixas de exibição: **P1** meta em tempo morto,
   **P2** meta, **P3** tempo morto, **P4** normal; ordem final por pontuação desc com desempate
   por dias parados.
4. **Auditoria de etiquetas:** processo atribuído sem etiqueta contendo o nome do seu servidor
   recebe `SEM_ETIQUETA_SERVIDOR`; etiqueta apontando para outro servidor da atribuição vira
   `ETIQUETA_DIVERGENTE` (o cálculo pelo dígito prevalece). O resumo do job alimenta o aviso de
   etiquetagem no frontend — a etiquetagem em lote pelo próprio Fórum Hub é evolução prevista.
5. **Saída e download:** abas com cabeçalho congelado (linha 4), autofiltro, destaque de dias
   (laranja ≥ 100, vermelho ≥ 120) e estilos compartilhados (`xlsx-common.ts`). O arquivo é
   nomeado com o jobId e `GET /:jobId/download` resolve **pelo jobId** — não repete o padrão
   "arquivo mais recente" de advogados. O `progressMap` tem TTL: jobs terminais expiram em 1 h,
   varridos a cada 30 min como o GC de arquivos.

Funções puras (dígito, atribuição, exclusão de tarefas, pontuação, ordenação, distribuição)
cobertas por Vitest em `src/__tests__/digito-core.test.ts`.

## 9 · Pesquisa geral

### 9.1 · Consulta pública JSF

`consulta-publica.ts` automatiza o `listView.seam`: baixa o formulário (`/search-form-options`
popula os selects de UF/OAB, jurisdição e órgão julgador), monta ~38 campos JSF fixos (ramo da
Justiça `8`, campos de captcha vazios), dispara a busca (`fPP:j_id459`) e pagina de 20 em 20 até
1 000 resultados, deduplicando por `idProcesso`. Validação: `nomeParte`/`nomeAdvogado` exigem
≥ 2 palavras e ao menos um critério preenchido.

### 9.2 · Planilha de resultados

`GET /search-sheet-stream` emite um evento `row` por processo — para cada linha o backend faz um
POST extra (`mostrarNosAtuais`) e devolve o **"Nó(s) atual(is)"** do fluxo. No cliente,
`PlanilhaPesquisaManager` acumula as linhas e gera o `.xlsx` *à mão* (OOXML mínimo — workbook,
styles, sheet com `inlineStr`, cabeçalho congelado e autofiltro — empacotado com JSZip/DEFLATE).
8 colunas, download automático ao final.

### 9.3 · Modo fila (pesquisa múltipla)

Com `modoFila` ativo, o usuário cola uma lista de nomes de parte (um por linha, mínimo de
2 palavras cada); os demais critérios preenchidos viram *filtros fixos* aplicados a todos. A
execução é sequencial: para cada nome, `executarBusca({...criteria, nomeParte})` roda o download
(`mode: 'by_search'`, com `FileSystemManager` compartilhado e `skipReport`) ou a planilha. Cada
item tem status `pendente → executando → concluido|erro|cancelado`; ao final um relatório TXT
consolidado (`_RELATORIO_PESQUISA_MULTIPLA_{ts}.txt`) é salvo na *raiz* da pasta escolhida,
separando partes com e sem processos e os itens não executados por cancelamento.

## 10 · Contratos de API

### Autenticação — `/api/pje/downloads/auth`

| Rota | Entrada | Comportamento |
| --- | --- | --- |
| `POST /login` | `{cpf, password}` | Valida CPF (11 dígitos); → `{needs2FA, sessionId, user?, profiles?, twoFactorType?}` |
| `POST /2fa` | `{sessionId, code}` | `code` = 6 dígitos; rejeição volta 200 com `needs2FA:true` (retry no mesmo sessionId) |
| `POST /profile` | `{sessionId, profileIndex}` | `-1` = perfil favorito; → `{tasks, favoriteTasks, tags}` |
| `GET /profiles` | `?sessionId` | Todos os perfis (varre a paginação) |
| `GET /validate-session` | `?sessionId` | Sempre 200: `{valid}` ou `{valid:false, reason:'NOT_FOUND'\|'EXPIRED'}` — base do F5 do frontend |

### Streaming — `/api/pje/downloads`

| Rota | Descrição |
| --- | --- |
| `GET /stream-batch?sessionId&mode&taskNames\|taskName&tagIds\|tagId&isFavorite&processNumbers&documentTypes&criteria` | SSE do download em lote (§5) |
| `POST /stream-batch/:streamId/cancel` | Cancelamento cooperativo (compartilhado pelo download e pela planilha de pesquisa) |
| `GET /search-sheet-stream?sessionId&criteria` | SSE da planilha de pesquisa — eventos `row` |
| `GET /search-form-options?sessionId` | Combos do formulário de pesquisa |
| `GET /document-types` | Catálogo estático de tipos (não consumido pela UI atual, que tem cópia local) |
| `GET /proxy/:token` | Streaming do arquivo S3 — token de uso único; 410 expirado, 502 upstream |

### Eventos SSE de `/stream-batch`

| Evento | Payload (essência) |
| --- | --- |
| `init` / `auth` | `{streamId}` · `{status:'ok'}` |
| `listing` | `{total, parallelSlots, documentTypes[], totalRequests}` |
| `precheck` | `{ready, total}` — reaproveitados da Área de Download |
| `progress` | `{index, total, processNumber, documentType}` |
| `url` | `{processNumber, documentType, downloadUrl, proxyUrl, fileName, fileSize?, method:'direct'\|'polled'\|'ready'}` |
| `queued` / `not_available` / `item_error` | por item, com `message`/`code` |
| `cancelled` / `done` / `fatal` | `done: {total, totalRequests, success, failed, notAvailable, reused, elapsed, cancelled}` |

### Advogados — `/api/pje/advogados` (exige `x-user`)

| Rota | Descrição |
| --- | --- |
| `POST /gerar` | `{credentials?\|pjeSessionId, fonte, taskNames[]\|taskName, tagIds[]\|tagId, filtros[], pjeProfileIndex}` → 202 `{jobId}` |
| `GET /:jobId/progress` | `{status, progress, totalProcesses, processedCount, message}` |
| `DELETE /:jobId` | Cancela |
| `GET /:jobId/download` | `.xlsx` com `Content-Disposition` |

### Planilha por dígito — `/api/pje/planilha-digito` (exige `x-user`)

| Rota | Descrição |
| --- | --- |
| `POST /gerar` | `{credentials?\|pjeSessionId, pjeProfileIndex, atribuicoes[{digito, servidor}], tarefasIgnoradas[], formato: 'xlsx'\|'zip', pesos?}` → 202 `{jobId}` |
| `GET /:jobId/progress` | `{status, progress, totalProcesses, processedCount, message, fileName?, resumo?}` — `resumo` traz distribuição, não atribuídos e pendências de etiqueta |
| `DELETE /:jobId` | Cancela |
| `GET /:jobId/download` | `.xlsx` ou `.zip`, resolvido **pelo jobId** (nome do arquivo carrega o jobId) |

## 11 · Constantes e limites operacionais

| Parâmetro | Valor | Onde |
| --- | --- | --- |
| Streams SSE por usuário / globais | 1 / 5 | stream.controller |
| Concorrência de requisições ao PJE | ParallelPool(3) + stagger 500 ms (200 ms "ready") | stream.controller |
| Downloads simultâneos no navegador | 3 (semáforo) | download-manager |
| Streams simultâneos no proxy S3 | 4 · token TTL 30 min · uso único | proxy.controller |
| Polling da Área de Download | início 5 s · backoff até 30 s · timeout 10 min | url-extractor |
| Página de listagem (tarefas/etiquetas) | 500 · teto 10 000 (by_task) | strategies |
| Pesquisa geral | 20/página · máx. 1 000 resultados | consulta-publica |
| Extração de advogados | 4 workers · stagger 250 ms | pje-advogados.service |
| Último movimento (planilha por dígito) | 4 workers · stagger 250 ms | planilha-digito.service |
| Pesos e limiares de prioridade | régua CNJ 100 dias · alerta 100 · crítico 120 · pesos de meta 40/35/30/20 | digito-core (`PESOS_PRIORIDADE_PADRAO`) |
| TTL do progressMap (planilha por dígito) | jobs terminais > 1 h, varridos a cada 30 min | planilha-digito.service |
| TTL sessão / sessão por CPF | 30 min (deslizante) / 4 h | session-store |
| Rate limit global da API | 100 req/min | server.ts |
| Limite do ZIP em memória | 1 GiB (acima: streaming/ZIP64) | filesystem-manager |
| GC de arquivos gerados | mtime > 1 h, varrido a cada 30 min | server.ts |
| Polling do job de advogados (UI) | 2,5 s | page.tsx |
| Heartbeat SSE / retry | 15 s / 60 s | stream.controller |

## 12 · Segurança e pontos de atenção

- **Identidade de aplicação simbólica:** o header `x-user` é um JSON fixo no cliente; qualquer
  chamador pode assumir o papel `magistrado`. Em produção só o CORS restringe a origem.
- **`sessionId` previsível:** gerado com `Date.now()` + `Math.random()` (não criptográfico),
  diferente do `randomUUID` usado nos tokens de proxy; trafega em query string.
- **Sem persistência real:** o progresso dos jobs de advogados some no restart e o `progressMap`
  não tem TTL (cresce até o restart); sessões sobrevivem apenas via `.pje-sessions.json`.
- **Acoplamento ao TJBA/1º grau:** hosts, `pje-tjba-1g`, `ramoJustica='8'`,
  `sistemaOrigem=PRIMEIRA_INSTANCIA` e ids JSF literais (`j_id66/68/70/72`, `j_id459`,
  `j_id507/508`) — qualquer atualização visual do PJE pode quebrar parsers e seleção de perfil.
- **Catálogo fixo de tipos:** risco de falso `not_available` quando o ID difere no processo
  (§5.3).
- **Divergências de configuração:** porta default do código é `10000`, mas
  Dockerfile/Render/frontend assumem `3001`; `/advogados/:jobId/download` entrega o arquivo mais
  recente do diretório, não o do job.
- **Erros silenciosos:** `ParallelPool` engole exceções das tarefas; vários `catch {}` em pontos
  de rede (decisão consciente de resiliência, mas dificulta diagnóstico).

## 13 · Higiene de código (limpeza de 08/2026)

Até agosto/2026 conviviam duas gerações no repositório: o fluxo SSE atual e um modelo anterior de
**jobs assíncronos com download no servidor**, além de módulos órfãos acumulados por
refatorações. Essa dívida foi **removida** nesta limpeza:

**Removido do backend**

- Subsistema de jobs legado: `jobs.controller.ts`, `pje-download.service.ts`,
  `pje-download-worker.ts` e `repositories/` (worker sequencial preso ao `userId=1`, duplicava
  ~400 linhas de lógica PJE, guardava credenciais em claro nos jobs e as devolvia via
  `GET /:jobId`) — as rotas de CRUD de jobs deixaram de existir.
- `services/download/collectors/` (exportado, nunca importado) e `shared/pdf-zip-extractor.ts`
  (usado só pelos removidos).
- Os 3 shims redundantes de `pje-auth-proxy.service.ts` — `auth.controller` agora importa direto
  de `services/pje-auth`.
- Dependências nunca registradas: `@fastify/jwt`, `@fastify/cookie` e `jszip` (backend; o
  `jszip` foi readmitido em 09/2026 com consumidor real — o ZIP da planilha por dígito, §8).
- Tipos legados de `shared/types.ts` (`PJEJobStatus`, `CreateDownloadJobDTO`,
  `DownloadJobResponse`, `PJEDownloadProgress` etc.).

**Removido do frontend**

- Hooks órfãos `useJobPoller`, `usePjeSession`, `useUiLogs`; `lib/errors.ts`; `logger.ts`;
  componentes `CardJob`, `PainelLogs` e `componentes/layout/*`; o barrel `index.ts` (não
  consumido).
- Funções de API do modelo legado (`criarJob`, `listarJobs`, `obterProgresso`, `cancelarJob`,
  `listarTiposDocumento`) e os tipos correspondentes em `types.ts` (`ParametrosDownload`,
  `STATUS_CONFIG`, `MODE_CONFIG`, `isJobActive` etc.); `validateDocumentTypes` em
  `tipos-documento.ts`.

**Duplicações consolidadas**

- `formatBytes` (4 cópias) → `lib/format.ts`, importado por `page.tsx`, `download-manager`,
  `TelaPesquisaGeral` e `ResultadoFinal`.
- `resolveBaseUrl` (2 cópias) → exportado de `download-manager` e reutilizado por
  `planilha-pesquisa`.
- `API_BASE` com semânticas divergentes → `TelaPesquisaGeral` passou a usar o de
  `lib/api-client` (o `resolveBaseUrl` cobre o fallback para `NEXT_PUBLIC_API_URL`).
- Constantes PJE duplicadas → `shared/pje-api-client.ts` é a fonte única;
  `services/pje-auth/constants.ts` apenas re-exporta.

**Ainda em aberto (não bloqueante):** `formatFileSize` em `types.ts` coexiste com `formatBytes`
(formatações ligeiramente diferentes); o endpoint `GET /document-types` segue no ar sem consumidor;
e as pequenas divergências da §12.

## 14 · Build, execução e deploy

### Desenvolvimento

```bash
# raiz — sobe API (tsx watch) e web (next dev) juntos
pnpm dev
```

```bash
# ou separado, com a porta que o frontend espera
cd backend  && PORT=3001 pnpm dev
cd frontend && pnpm dev   # exige frontend/.env.local com NEXT_PUBLIC_API_URL=http://localhost:3001
```

### Variáveis de ambiente

| Variável | App | Default | Uso |
| --- | --- | --- | --- |
| `PORT` | backend | 10000 | Porta da API (Docker/Render usam 3001) |
| `NODE_ENV` | backend | development | CORS restrito, logs JSON, exige `x-user` |
| `NEXT_PUBLIC_API_URL` | frontend | — | Destino do rewrite `/api/*` e base do SSE |
| `NEXT_PUBLIC_ZIP_SW_URL` | frontend | `/zip-sw.js` | Service worker do ZIP streaming |
| `NEXT_PUBLIC_PJE_DEBUG` | frontend | false | Logs detalhados no console |

### Produção

- **Backend — Render** (`render.yaml`): `rootDir: backend`, `pnpm install && pnpm build`,
  `node dist/server.js`, `PORT=3001`, health-check `/api/health`. Alternativa: `Dockerfile`
  multi-stage `node:20-alpine` (sem prune de devDependencies no estágio final).
- **Frontend — Vercel**: `pje-services-web-frontend.vercel.app`, origin liberado no CORS de
  produção (mais o wildcard `/\.vercel\.app$/`).
- Observabilidade: log de memória a cada 30 s, log de requisições `/api/pje` com duração,
  handlers globais de `unhandledRejection`/`uncaughtException` apenas logando.

---

*Documento gerado a partir da leitura integral do código (branch `main`, 26/08/2026).*
