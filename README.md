# PJE Download - Standalone

Sistema para download de processos do PJE/TJBA, extraído do monorepo forum-hub.

## Estrutura

```
pje-download/
├── backend/          # API Fastify (Node.js)
│   └── src/
│       ├── server.ts
│       ├── middleware/
│       ├── shared/          # Tipos e utilitários (antes era pacote 'shared')
│       └── modules/pje-download/
│           ├── controllers/
│           ├── repositories/
│           └── services/
├── frontend/         # Next.js (React)
│   └── src/app/
│       ├── componentes/pje-download/
│       ├── hooks/
│       ├── lib/
│       └── magistrado/pje-download/
├── extract-from-monorepo.sh  # Script de extração automática
└── package.json      # Workspace root
```

## Setup Inicial (a partir do monorepo)

Se você tem o monorepo forum-hub original:

```bash
# 1. Extrair arquivos fonte automaticamente
./extract-from-monorepo.sh /caminho/para/forum-hub

# 2. Instalar dependências
pnpm install

# 3. Rodar
pnpm dev
```

## Requisitos

- Node.js >= 20
- pnpm >= 10

## Instalação

```bash
pnpm install
```

## Desenvolvimento

```bash
# Rodar tudo junto (API + Frontend)
pnpm dev

# Ou separado
pnpm dev:api   # Backend em http://localhost:3001
pnpm dev:web   # Frontend em http://localhost:3000
```

Acesse: http://localhost:3000/magistrado/pje-download

## Variáveis de Ambiente

### Backend (.env)
```
PORT=3001
NODE_ENV=development
```

### Frontend (.env.local)
```
NEXT_PUBLIC_API_URL=http://localhost:3001
```

---

## 🆓 Deploy Gratuito (Separado: Frontend + Backend)

A melhor forma de rodar gratuitamente é separar frontend e backend:

### Frontend → Vercel (100% gratuito)

1. Push do código para GitHub
2. Acesse [vercel.com](https://vercel.com) e importe o repositório
3. Configure:
   - **Root Directory**: `frontend`
   - **Framework Preset**: Next.js (detecta automaticamente)
   - **Environment Variables**: 
     - `NEXT_PUBLIC_API_URL` = URL do backend (ex: `https://pje-api.railway.app`)
4. Deploy!

**Vantagens Vercel**: Deploy automático no push, CDN global, domínio gratuito `*.vercel.app`

### Backend → Railway (500h grátis/mês)

1. Acesse [railway.app](https://railway.app) e conecte o GitHub
2. Crie um novo projeto → selecione o repositório
3. Configure:
   - **Root Directory**: `backend`
   - **Build Command**: `pnpm install && pnpm build`
   - **Start Command**: `pnpm start`
   - **Environment Variables**:
     - `PORT` = `3001`
     - `NODE_ENV` = `production`
4. Deploy!

**Vantagens Railway**: 500h grátis/mês ($5 crédito), sem cold start, deploy automático

### Backend → Render (alternativa, grátis com cold start)

1. Acesse [render.com](https://render.com)
2. New → Web Service → conecte o repositório
3. Configure:
   - **Root Directory**: `backend`
   - **Build Command**: `pnpm install && pnpm build`
   - **Start Command**: `node dist/server.js`
   - **Environment**: Node
   - **Instance Type**: Free
4. Deploy!

**Nota**: O plano gratuito do Render tem "spin down" após 15min de inatividade 
(demora ~30s para voltar). O Railway não tem esse problema.

### Backend → Fly.io (alternativa, 3 VMs grátis)

```bash
cd backend
fly launch
fly deploy
```

### Resumo das Opções Gratuitas

| Serviço  | Parte     | Grátis?         | Cold Start? | Melhor para        |
|----------|-----------|-----------------|-------------|---------------------|
| Vercel   | Frontend  | ✅ Sim          | ❌ Não      | Frontend Next.js    |
| Railway  | Backend   | ✅ 500h/mês     | ❌ Não      | Backend sempre on   |
| Render   | Backend   | ✅ Sim          | ⚠️ 30s     | Backend uso casual  |
| Fly.io   | Backend   | ✅ 3 VMs        | ❌ Não      | Backend global      |

**Recomendação**: **Vercel (frontend) + Railway (backend)** = melhor experiência gratuita.
