# PJE Download — TJBA

Aplicação para download de processos do PJE/TJBA e geração de planilhas de advogados.

O projeto é dividido em dois aplicativos independentes:

- **`backend/`** — API em [Fastify](https://fastify.dev) (TypeScript) que faz o proxy de autenticação e o download dos processos no PJE.
- **`frontend/`** — Interface em [Next.js 16](https://nextjs.org) (React 19) que consome a API.

---

## Requisitos

- **Node.js 20+** (a imagem Docker usa `node:20-alpine`).
- **pnpm 10.28.2** — o backend fixa essa versão em `packageManager`. A forma recomendada de obter é via Corepack (já incluso no Node):

```bash
corepack enable
corepack prepare pnpm@10.28.2 --activate
```

---

## Variáveis de ambiente

### Backend (`backend/`)

| Variável     | Padrão        | Descrição                                              |
| ------------ | ------------- | ------------------------------------------------------ |
| `PORT`       | `10000`       | Porta da API. **Use `3001` em dev** (veja a nota abaixo). |
| `NODE_ENV`   | `development` | `production` ativa CORS restrito e logs JSON.          |
| `LOG_LEVEL`  | `info`        | Nível de log (somente fora de produção).               |

> **Nota sobre a porta:** o `server.ts` usa `10000` por padrão, mas o `Dockerfile` e os defaults do frontend apontam para `3001`. Para rodar local sem ajustar o frontend, suba o backend em `3001`.

### Frontend (`frontend/`)

| Variável                | Padrão                  | Descrição                                                                 |
| ----------------------- | ----------------------- | ------------------------------------------------------------------------- |
| `NEXT_PUBLIC_API_URL`   | _(vazio)_               | URL do backend. **Necessária**: o `next.config.ts` faz proxy de `/api/*` para essa URL (evita CORS no SSE/EventSource). |
| `NEXT_PUBLIC_PJE_DEBUG` | `false`                 | `true` ativa logs detalhados no console do navegador.                     |

Crie um arquivo `frontend/.env.local`:

```bash
NEXT_PUBLIC_API_URL=http://localhost:3001
```

---

## Instalação

Instale as dependências de cada aplicativo separadamente.

```bash
# Backend
cd backend
pnpm install

# Frontend
cd ../frontend
pnpm install
```

---

## Desenvolvimento (rodando os dois juntos)

Abra **dois terminais**.

**Terminal 1 — Backend** (na porta 3001):

```bash
cd backend
PORT=3001 pnpm dev
```

> No Windows (PowerShell): `$env:PORT="3001"; pnpm dev`
> No Windows (CMD): `set PORT=3001 && pnpm dev`

**Terminal 2 — Frontend** (na porta 3000):

```bash
cd frontend
pnpm dev
```

Acesse **http://localhost:3000** (a raiz redireciona para `/pje/pje-download`).

A saúde da API pode ser verificada em **http://localhost:3001/api/health**.

---

## Build e produção

### Backend

```bash
cd backend
pnpm build        # compila TypeScript -> dist/
pnpm start        # executa node dist/server.js
```

Em produção, defina ao menos `NODE_ENV=production` e `PORT`:

```bash
NODE_ENV=production PORT=3001 pnpm start
```

### Frontend

```bash
cd frontend
pnpm build        # next build
pnpm start        # next start (porta 3000)
```

Lembre-se de definir `NEXT_PUBLIC_API_URL` apontando para o backend no ambiente de build/deploy.

---

## Testes e lint

```bash
# Backend — testes (Vitest)
cd backend
pnpm test         # roda os testes uma vez
pnpm test:watch   # modo watch

# Frontend — lint (ESLint)
cd frontend
pnpm lint
```

---

## Docker (backend)

O backend já tem um `Dockerfile`. Ele define `PORT=3001`, expõe a porta `3001` e inclui um healthcheck em `/api/health`.

```bash
cd backend
docker build -t pje-backend .
docker run -p 3001:3001 -e NODE_ENV=production pje-backend
```

---

## Resumo dos comandos

| Aplicativo | Comando            | O que faz                          |
| ---------- | ------------------ | ---------------------------------- |
| Backend    | `pnpm dev`         | Dev com reload (`tsx watch`)       |
| Backend    | `pnpm build`       | Compila para `dist/`               |
| Backend    | `pnpm start`       | Roda o build de produção           |
| Backend    | `pnpm test`        | Testes com Vitest                  |
| Backend    | `pnpm test:watch`  | Testes em modo watch               |
| Frontend   | `pnpm dev`         | Dev server (porta 3000)            |
| Frontend   | `pnpm build`       | Build de produção                  |
| Frontend   | `pnpm start`       | Serve o build de produção          |
| Frontend   | `pnpm lint`        | ESLint                             |

---

## Observações

- As credenciais do PJE são enviadas diretamente ao PJE pela API e **não são armazenadas**.
- No frontend, o download dos PDFs usa a **File System Access API** (Chrome/Edge) para salvar direto numa pasta; em navegadores sem suporte (Firefox/Safari), cai automaticamente para download em **ZIP**.
- Em produção, o CORS do backend libera apenas a origem do frontend na Vercel (`*.vercel.app`); ajuste `ALLOWED_ORIGINS` em `backend/src/server.ts` se hospedar em outro domínio.