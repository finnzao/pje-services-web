# Setup Guide - Copying Source Files

This project was extracted from a monorepo. Most configuration files and 
key source files are included. Some large source files need to be copied 
from the original project.

## Files included (ready to use):
- All config files (package.json, tsconfig, etc.)
- backend/src/server.ts
- backend/src/middleware/*
- backend/src/shared/*  
- backend/src/modules/pje-download/repositories/*
- backend/src/modules/pje-download/services/pje-download.service.ts
- backend/src/modules/pje-download/services/pje-auth/{constants,types,index,session-store}.ts
- frontend/ (all component files)

## Files to copy from original monorepo:

### Backend (copy from apps/api/src/ to backend/src/)
After copying, run: `sed -i "s/from 'shared'/from '<RELATIVE_PATH>shared\/types'/g"` 
on files that import from 'shared'.

Copy these directories as-is (no import changes needed):
- modules/pje-download/services/pje-auth/cookie-jar.ts
- modules/pje-download/services/pje-auth/html-parser.ts  
- modules/pje-download/services/pje-auth/http-client.ts
- modules/pje-download/services/pje-auth/pje-auth-proxy.ts
- modules/pje-download/services/pje-auth/profile-extractor.ts

Copy with 'shared' import fix:
- modules/pje-download/services/download/* (all files)
- modules/pje-download/controllers/* (all files)
- modules/pje-download/services/pje-advogados/* (all files)
- modules/pje-download/index.ts

### Frontend (copy from apps/web/src/ to frontend/src/)
All frontend files can be copied as-is (no import changes).
