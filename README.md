# PJE Download — Patch

Substitua os arquivos abaixo no projeto. A estrutura de pastas dentro deste ZIP é a mesma do projeto — basta copiar `backend/` e `frontend/` para a raiz.

## Mudanças

- **Fix 2FA TOTP**: Microsoft/Google Authenticator agora funciona (campo `otp` + `login=Validar` em vez de `code`).
- **Filtro por tipo de documento**: multi-select com IDs reais; faz 1 request por tipo.
- **Modo `by_number`**: lista de processos por número CNJ com descoberta via painel_filtrado.

## Arquivos

### Backend (9)

```
backend/src/shared/types.ts
backend/src/shared/tipos-documento.ts                                          [NOVO]
backend/src/modules/pje-download/controllers/auth.controller.ts
backend/src/modules/pje-download/controllers/stream.controller.ts
backend/src/modules/pje-download/services/pje-auth/html-parser.ts
backend/src/modules/pje-download/services/pje-auth/pje-auth-proxy.ts
backend/src/modules/pje-download/services/pje-auth/types.ts
backend/src/modules/pje-download/services/download/url-extractor.ts
backend/src/modules/pje-download/services/download/strategies/by-number.strategy.ts
```

### Frontend (12)

```
frontend/src/app/componentes/pje-download/tipos-documento.ts                   [NOVO]
frontend/src/app/componentes/pje-download/SeletorTipoDocumento.tsx             [NOVO]
frontend/src/app/componentes/pje-download/ListaProcessos.tsx                   [NOVO]
frontend/src/app/componentes/pje-download/types.ts
frontend/src/app/componentes/pje-download/api.ts
frontend/src/app/componentes/pje-download/index.ts
frontend/src/app/componentes/pje-download/EtapaLogin.tsx
frontend/src/app/componentes/pje-download/DownloadAction.tsx
frontend/src/app/componentes/pje-download/DownloadModeSelector.tsx
frontend/src/app/hooks/usePjeSession.ts
frontend/src/app/lib/download-manager.ts
frontend/src/app/pje/pje-download/page.tsx
```

## Pontos críticos

- `tipos-documento.ts` é espelhado backend↔frontend. Ao adicionar novos tipos, atualize **ambos**.
- Filtro de tipo vazio → omite `cbTipoDocumento` no POST (baixa tudo). Enviar `"0"` baixaria nada.
- 2FA com código inválido: backend retorna 200 com `data.error` para preservar `sessionId` no frontend.
- Novo evento SSE `not_available` é não-fatal (UI mostra cinza/amarelo, não vermelho).
- Endpoint extra: `GET /api/pje/downloads/document-types` (opcional para a UI).
