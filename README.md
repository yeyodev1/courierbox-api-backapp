# Courier Box API

Public tracking API. Node 20 + Express + TypeScript. Playwright-core scraper que corre **dual mode**:

- **Local dev**: `playwright` (devDep) + Chromium bundled
- **Serverless (Vercel/AWS Lambda)**: `playwright-core` + `@sparticuz/chromium`

Mongo wired pero **deshabilitado** (`src/db/mongo.ts`).

## Setup local

```bash
cd courierbox-api
pnpm install
pnpm playwright:install      # baja Chromium para playwright (dev)
cp .env.example .env         # llenar COURIER_USER y COURIER_PASS
pnpm dev                     # http://localhost:8100
```

Smoke:
```bash
curl http://localhost:8100/health
curl http://localhost:8100/api/tracking/TBA329054881595
```

## Endpoints

- `GET /` → ping JSON
- `GET /health` → uptime + version
- `GET /api/tracking/:codigo` → resultado completo (WR + login + iframe + WR/SH pages)
- `GET /api/tracking/:codigo/text` → versión texto (paridad con bot Python)

## Deploy a Vercel

Archivos clave:
- `api/index.ts` — entrypoint serverless (re-exporta el Express app)
- `vercel.json` — rewrites + memory 1024 + maxDuration 60
- `@sparticuz/chromium` se carga **solo** en Vercel (detección por `process.env.VERCEL`)

### Variables de entorno (Vercel → Project → Settings → Environment Variables)

| Variable | Valor |
|---|---|
| `COURIER_USER` | `admin` |
| `COURIER_PASS` | `courierbox45` |
| `COURIER_URL` | `https://courierbox.sistemaml.info/index.php?accesscheck=%2Fjc_home.php` |
| `FRONTEND_ORIGIN` | `https://tu-frontend.vercel.app` (CSV si hay varios) |
| `NODE_ENV` | `production` |
| `SCRAPER_TIMEOUT_MS` | `55000` (margen sobre el límite de 60s) |
| `CACHE_TTL_SECONDS` | `60` |

### Plan recomendado
**Vercel Pro** — el plan Hobby corta funciones a 10s y el scraper toma 15–30s. Pro permite hasta 60s con el `maxDuration` configurado.

### Deploy
```bash
vercel --prod
```
o conecta el repo y deja que Vercel haga deploy automático en cada push.

### Cómo verificar
1. `https://tu-api.vercel.app/` → JSON `📦 Courierbox API is alive`
2. `https://tu-api.vercel.app/health` → `{"status":"ok",...}`
3. `https://tu-api.vercel.app/api/tracking/TBA329054881595` → resultado completo
4. Si da 500: ver logs en Vercel → Project → Deployments → último → Functions → /api

## Activar persistencia (opcional)
Cuando quieras Mongo:
1. `pnpm add mongoose`
2. Descomentar `src/db/mongo.ts`
3. En `src/app.ts` o un bootstrap async llamar `await connectMongo(env.MONGO_URI)`
4. Setear `MONGO_URI` en `.env`

## Limitaciones serverless conocidas

- **Cold start ~3–5s** para arrancar Chromium en Lambda
- **Cache en memoria** se pierde entre invocaciones (cada request hace fresh scrape)
- **Rate-limit por IP** se pierde entre invocaciones (no proteges sin Redis)
- Para producción seria considerá mover a **Railway/Fly.io** (proceso largo) y dejar Vercel solo para el frontend
