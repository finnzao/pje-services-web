#!/bin/bash
# ============================================================
# Script para extrair pje-download do monorepo forum-hub
# 
# Uso: ./extract-from-monorepo.sh /caminho/para/forum-hub
# ============================================================
set -e

MONOREPO="${1:?Uso: $0 /caminho/para/forum-hub}"
DEST="$(cd "$(dirname "$0")" && pwd)"

if [ ! -d "$MONOREPO/apps/api" ]; then
    echo "❌ Diretório do monorepo inválido. Esperado: apps/api/"
    exit 1
fi

echo "📦 Extraindo pje-download de: $MONOREPO"
echo "📁 Destino: $DEST"

# ════════════════════════════════════════
# BACKEND: Copiar arquivos da API
# ════════════════════════════════════════
SRC_API="$MONOREPO/apps/api/src"
DST_API="$DEST/backend/src"

echo ""
echo "═══ BACKEND ═══"

# Middleware
echo "  📄 middleware/"
cp "$SRC_API/middleware/auth.ts" "$DST_API/middleware/"
cp "$SRC_API/middleware/error-handler.ts" "$DST_API/middleware/"

# Shared utilities  
echo "  📄 shared/"
cp "$SRC_API/shared/errors.ts" "$DST_API/shared/"
cp "$SRC_API/shared/response.ts" "$DST_API/shared/"
cp "$SRC_API/shared/parallel-pool.ts" "$DST_API/shared/"
cp "$SRC_API/shared/pje-api-client.ts" "$DST_API/shared/"

# PJE Download module - copy entire tree
echo "  📄 modules/pje-download/"
cp -r "$SRC_API/modules/pje-download/" "$DST_API/modules/pje-download/"

# Server  
echo "  📄 server.ts"
cp "$SRC_API/server.ts" "$DST_API/"

# Tests
echo "  📄 __tests__/"
mkdir -p "$DST_API/__tests__"
cp -r "$SRC_API/__tests__/" "$DST_API/__tests__/" 2>/dev/null || true

# ════════════════════════════════════════
# Fix imports: 'shared' -> relative path
# ════════════════════════════════════════
echo ""
echo "🔧 Corrigindo imports de 'shared'..."

# Function to calculate relative path depth
fix_imports_in_dir() {
    local dir="$1"
    local depth="$2"
    local prefix=""
    for ((i=0; i<depth; i++)); do prefix="../$prefix"; done
    
    find "$dir" -name "*.ts" -type f | while read -r file; do
        if grep -q "from 'shared'" "$file" 2>/dev/null; then
            # Calculate this file's depth from backend/src/
            local rel="${file#$DST_API/}"
            local file_dir="$(dirname "$rel")"
            local file_depth=$(echo "$file_dir" | tr '/' '\n' | wc -l)
            local file_prefix=""
            for ((j=0; j<file_depth; j++)); do file_prefix="../$file_prefix"; done
            
            sed -i "s|from 'shared'|from '${file_prefix}shared/types'|g" "$file"
            echo "    ✓ Fixed: $rel"
        fi
    done
}

fix_imports_in_dir "$DST_API" 0

# ════════════════════════════════════════
# Remove unused imports from server.ts
# ════════════════════════════════════════

# Fix server.ts to not import from forum-hub specific modules
# (it should only import pje-download module)

# ════════════════════════════════════════
# FRONTEND: Copiar componentes
# ════════════════════════════════════════
SRC_WEB="$MONOREPO/apps/web/src"
DST_WEB="$DEST/frontend/src"

echo ""
echo "═══ FRONTEND ═══"

# Copy app directory structure
echo "  📄 app/componentes/pje-download/"
mkdir -p "$DST_WEB/app/componentes/pje-download"
cp "$SRC_WEB/app/componentes/pje-download/"*.ts "$DST_WEB/app/componentes/pje-download/" 2>/dev/null || true
cp "$SRC_WEB/app/componentes/pje-download/"*.tsx "$DST_WEB/app/componentes/pje-download/" 2>/dev/null || true

echo "  📄 app/componentes/layout/"
mkdir -p "$DST_WEB/app/componentes/layout"
cp "$SRC_WEB/app/componentes/layout/Cabecalho.tsx" "$DST_WEB/app/componentes/layout/" 2>/dev/null || true
cp "$SRC_WEB/app/componentes/layout/Rodape.tsx" "$DST_WEB/app/componentes/layout/" 2>/dev/null || true

echo "  📄 app/hooks/"
mkdir -p "$DST_WEB/app/hooks"
cp "$SRC_WEB/app/hooks/"*.ts "$DST_WEB/app/hooks/" 2>/dev/null || true

echo "  📄 app/lib/"
mkdir -p "$DST_WEB/app/lib"
cp "$SRC_WEB/app/lib/"*.ts "$DST_WEB/app/lib/" 2>/dev/null || true

echo "  📄 app/magistrado/pje-download/"
mkdir -p "$DST_WEB/app/magistrado/pje-download"
cp "$SRC_WEB/app/magistrado/pje-download/page.tsx" "$DST_WEB/app/magistrado/pje-download/" 2>/dev/null || true

echo "  📄 app/globals.css"
cp "$SRC_WEB/app/globals.css" "$DST_WEB/app/" 2>/dev/null || true

# Copy layout.tsx if exists
cp "$SRC_WEB/app/layout.tsx" "$DST_WEB/app/" 2>/dev/null || true

echo ""
echo "════════════════════════════════════════"
echo "✅ Extração concluída!"
echo ""
echo "Próximos passos:"
echo "  1. cd $DEST"
echo "  2. pnpm install"
echo "  3. pnpm dev"
echo ""
echo "Frontend: http://localhost:3000/magistrado/pje-download"
echo "Backend:  http://localhost:3001/api/health"
echo "════════════════════════════════════════"
