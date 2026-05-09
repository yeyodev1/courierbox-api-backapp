# Courier Box API

Public tracking API for Courier Box. Node + Express + TypeScript + Playwright.

## Stack
- Express 4 (ESM, TS)
- Playwright (Chromium) para resolver guías contra el sistema interno
- Cache + dedup en memoria, sin Redis
- Mongo **deshabilitado** (`src/db/mongo.ts` documenta cómo activarlo)

## Setup
```bash
cd courierbox-api
pnpm install              # o npm install
pnpm playwright:install   # baja Chromium
cp .env.example .env      # llenar COURIER_USER y COURIER_PASS
pnpm dev
```

## Endpoints

```
GET /health
GET /api/tracking/:codigo
GET /api/tracking/:codigo/text
```

### Smoke test
```bash
curl http://localhost:8100/health
curl http://localhost:8100/api/tracking/AB123456
```

## Activar persistencia (cuando se quiera)
1. `pnpm add mongoose`
2. Descomentar el cuerpo de `src/db/mongo.ts`.
3. En `src/app.ts` descomentar el import y llamar `await connectMongo(env.MONGO_URI)` en un bootstrap async desde `src/server.ts` antes de `app.listen`.
4. Definir `MONGO_URI` en `.env`.

## Nota arquitectónica
El bot de WhatsApp en Python (`../Courier-bot-tracking/`) sigue corriendo aparte. Este API es la fuente de tracking que consume el frontend Vue.
