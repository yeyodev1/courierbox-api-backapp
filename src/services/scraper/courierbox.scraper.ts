import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";
import { withContext } from "./browser.js";
import type {
  EstadoCanonico,
  TrackingCosto,
  TrackingEvento,
  TrackingResult,
} from "../../types/tracking.js";
import type { Page, Frame, BrowserContext } from "playwright";

export class ScraperError extends Error {
  constructor(
    public kind: "not_found" | "invalid_credentials" | "timeout" | "scraper_unavailable",
    message?: string
  ) {
    super(message ?? kind);
    this.name = "ScraperError";
  }
}

const URL_PUBLICA = "https://sistema.tmalogistics.com/trackingagente.php";
const PRECIO_POR_LIBRA = 5.99;
const ARANCEL_POR_LIBRA = 2.5;

export function calcularCosto(pesoLb: number | null): TrackingCosto | null {
  if (pesoLb == null || Number.isNaN(pesoLb) || pesoLb <= 0) return null;
  const flete = round2(pesoLb * PRECIO_POR_LIBRA);
  const arancel = round2(pesoLb * ARANCEL_POR_LIBRA);
  return { pesoLb, flete, arancel, total: round2(flete + arancel) };
}
function round2(n: number): number { return Math.round(n * 100) / 100; }

export function mapEstado(raw: string): EstadoCanonico {
  const lower = (raw || "").toLowerCase();
  if (/entreg/.test(lower)) return "entregado";
  if (/aduan/.test(lower)) return "en_aduana";
  if (/distribu|reparto/.test(lower)) return "en_distribucion";
  if (/tr[áa]nsito|en\s*v[ií]a|embarc/.test(lower)) return "en_transito";
  if (/miami|bodega|warehouse/.test(lower)) return "en_bodega_miami";
  if (/incidenc|reten|problema|devuelt/.test(lower)) return "incidencia";
  if (/creado|registr|recibido|recepci/.test(lower)) return "creado";
  return "desconocido";
}

function parseLb(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = s.match(/(\d+(?:[.,]\d+)?)/);
  if (!m || !m[1]) return null;
  const n = Number(m[1].replace(",", "."));
  return Number.isNaN(n) ? null : n;
}

function parseFecha(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim();
  // dd/mm/yyyy [hh:mm[:ss]] [am|pm]
  const m = t.match(
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?\s*m\.?)?)?/i
  );
  if (m && m[1] && m[2] && m[3]) {
    const d = m[1];
    const mo = m[2];
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    let hh = m[4] ? Number(m[4]) : 0;
    const mm = m[5] ? Number(m[5]) : 0;
    const ss = m[6] ? Number(m[6]) : 0;
    const ampm = (m[7] || "").toLowerCase().replace(/[.\s]/g, "");
    if (ampm === "pm" && hh < 12) hh += 12;
    if (ampm === "am" && hh === 12) hh = 0;
    const dt = new Date(
      `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
    );
    if (!Number.isNaN(dt.getTime())) return dt.toISOString();
  }
  const iso = Date.parse(t);
  if (!Number.isNaN(iso)) return new Date(iso).toISOString();
  return null;
}

function baseUrlOf(u: string): string {
  try {
    const p = new URL(u);
    return `${p.protocol}//${p.host}`;
  } catch {
    return "https://courierbox.sistemaml.info";
  }
}

const SISTEMA_BASE = baseUrlOf(env.COURIER_URL);

export async function obtenerEstadoGuia(codigoRaw: string): Promise<TrackingResult> {
  const tracking = (codigoRaw || "").trim().toUpperCase();
  if (!tracking) throw new ScraperError("not_found", "Tracking vacío");

  const timeoutMs = env.SCRAPER_TIMEOUT_MS;

  return withContext(async (ctx) => {
    const page = await ctx.newPage();
    page.setDefaultTimeout(timeoutMs);
    page.setDefaultNavigationTimeout(timeoutMs);

    try {
      // ── PASO 1: página pública → WR + history ──────────────────────
      logger.info("[scraper] paso 1: pública", { tracking });
      await page.goto(URL_PUBLICA, { waitUntil: "domcontentloaded" });
      await page.waitForSelector('input[name="number_tracking"]', { timeout: 15000 });
      await page.fill('input[name="number_tracking"]', tracking);
      await page.click("button#btnBuscar");
      await page.waitForSelector("div#DivContenido", { timeout: 15000 });
      await page.waitForTimeout(1500);

      const cabecera = (await page.textContent("div#DivContenido .alert").catch(() => "")) || "";
      const contenidoText = (await page.textContent("div#DivContenido").catch(() => "")) || "";

      const wrMatch = /\bWR\s*(\d+)\b/i.exec(contenidoText);
      if (!wrMatch || !wrMatch[1]) {
        throw new ScraperError(
          "not_found",
          `No encontramos número WR para ${tracking}. Verifica el código.`
        );
      }
      const wrNumero = wrMatch[1];
      const wrFull = `WR${wrNumero}`;

      const cabeceraDatos = parsearCabecera(cabecera);
      const eventos = await extraerHistory(page);

      // ── PASO 2: login al sistema interno ──────────────────────────
      logger.info("[scraper] paso 2: login", { wr: wrFull });
      await page.goto(env.COURIER_URL, { waitUntil: "domcontentloaded" });
      await page.waitForSelector('input[name="USUARIO2"]', { timeout: 10000 });
      await page.fill('input[name="USUARIO2"]', env.COURIER_USER);
      await page.fill('input[name="PASS2"]', env.COURIER_PASS);
      await page.press('input[name="PASS2"]', "Enter");
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

      // Validar login exitoso
      const stillLogin = await page.locator('input[name="USUARIO2"]').count();
      if (stillLogin > 0) {
        throw new ScraperError("invalid_credentials", "Credenciales inválidas o sesión expirada");
      }

      // ── PASO 3: buscar WR ─────────────────────────────────────────
      await page.waitForSelector('input[name="numero"]', { timeout: 15000 });
      await page.fill('input[name="numero"]', wrNumero);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(2000);

      // ── PASO 4: iframe con resultado → links WR + SH ──────────────
      const iframeEl = await page.waitForSelector(
        'iframe[src*="jc2_buscar_wr"], iframe[src*="buscar_wr"]',
        { timeout: 15000 }
      );
      const frame = await iframeEl.contentFrame();
      if (!frame) {
        throw new ScraperError("scraper_unavailable", "No se pudo abrir el iframe del WR");
      }
      await frame.waitForSelector("a.texto", { timeout: 15000 });

      const links = await frame.$$eval("a.texto", (els) =>
        els.map((a) => ({
          href: a.getAttribute("href") || "",
          text: (a.textContent || "").trim(),
        }))
      );

      let wrHref: string | null = null;
      let shHref: string | null = null;
      for (const { href, text } of links) {
        if (href && href.includes("jc2_print")) wrHref = href;
        else if (href && (href.includes("jc2_viewAgrupaciones") || text.toUpperCase().startsWith("SH"))) {
          shHref = href;
        }
      }

      // ── PASO 5: página WR (notes, descripción, peso, imágenes) ────
      const datosWr = wrHref
        ? await abrirYExtraer(ctx, absUrl(wrHref), extraerDatosWr)
        : { notes: null, description: null, pesoLb: null, imagenes: [] };

      // ── PASO 6: página SH (status, fecha, consignee) ──────────────
      const datosSh = shHref
        ? await abrirYExtraer(ctx, absUrl(shHref), extraerDatosSh)
        : { status: null, fecha: null, consignee: null };

      const pesoLb = datosWr.pesoLb ?? cabeceraDatos.pesoLb ?? null;
      const estadoLabel =
        datosSh.status ||
        (eventos[eventos.length - 1]?.descripcion ?? "Sin movimientos");

      const result: TrackingResult = {
        codigo: tracking,
        wr: wrFull,
        estado: mapEstado(estadoLabel),
        estadoLabel,
        descripcion: datosWr.description ?? cabeceraDatos.descripcion ?? null,
        notes: datosWr.notes ?? null,
        consignee: datosSh.consignee ?? null,
        pesoLb,
        costo: calcularCosto(pesoLb),
        fechaRecepcion: cabeceraDatos.fechaRecepcionISO ?? cabeceraDatos.fechaRecepcionRaw ?? null,
        fechaEstado: parseFecha(datosSh.fecha) ?? datosSh.fecha ?? null,
        eventos,
        imagenes: datosWr.imagenes ?? [],
        actualizadoEn: new Date().toISOString(),
      };

      return result;
    } catch (err) {
      if (err instanceof ScraperError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      if (/timeout/i.test(msg)) throw new ScraperError("timeout", msg);
      throw new ScraperError("scraper_unavailable", msg);
    } finally {
      await page.close().catch(() => {});
    }
  });
}

function absUrl(href: string): string {
  if (!href) return "";
  if (/^https?:\/\//i.test(href)) return href;
  return `${SISTEMA_BASE}/${href.replace(/^\/+/, "")}`;
}

async function abrirYExtraer<T>(
  ctx: BrowserContext,
  url: string,
  extractor: (p: Page) => Promise<T>
): Promise<T> {
  const sub = await ctx.newPage();
  try {
    await sub.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await sub.waitForSelector("body", { timeout: 15000 });
    return await extractor(sub);
  } finally {
    await sub.close().catch(() => {});
  }
}

interface CabeceraParsed {
  fechaRecepcionRaw: string | null;
  fechaRecepcionISO: string | null;
  descripcion: string | null;
  pesoLb: number | null;
}

function parsearCabecera(texto: string): CabeceraParsed {
  if (!texto || !texto.trim()) {
    return { fechaRecepcionRaw: null, fechaRecepcionISO: null, descripcion: null, pesoLb: null };
  }
  const norm = texto.replace(/\s+/g, " ").trim();
  const fecha = norm.match(/Fecha y hora:\s*([0-9\/\-]+\s+[0-9:]+\s*[APMapm.]*)/i);
  const desc = norm.match(/Descripci[oó]n:\s*(.+?)\s*-\s*Lb:/i);
  const peso = norm.match(/Lb:\s*([\d.,]+)/i);
  return {
    fechaRecepcionRaw: fecha?.[1]?.trim() ?? null,
    fechaRecepcionISO: parseFecha(fecha?.[1]?.trim() ?? null),
    descripcion: desc?.[1]?.trim() ?? null,
    pesoLb: parseLb(peso?.[1] ?? null),
  };
}

async function extraerHistory(page: Page): Promise<TrackingEvento[]> {
  const rows = await page
    .$$eval("div#DivContenido table tbody tr", (trs) =>
      trs
        .map((tr) => Array.from(tr.querySelectorAll("td")).map((td) => (td.textContent || "").trim()))
        .filter((cols) => cols.length >= 5)
    )
    .catch(() => [] as string[][]);

  return rows.map((c) => ({
    fecha: parseFecha(c[1] ?? ""),
    fechaTexto: c[1] ?? "",
    descripcion: `${c[3] ?? ""} — ${c[4] ?? ""}`.replace(/^\s*—\s*|\s*—\s*$/g, "").trim() || (c[4] ?? ""),
    accion: c[3] ?? "",
    ubicacion: c[2] ?? "",
  }));
}

interface DatosWr {
  notes: string | null;
  description: string | null;
  pesoLb: number | null;
  imagenes: string[];
}

async function extraerDatosWr(page: Page): Promise<DatosWr> {
  // notes
  const notes = await page
    .evaluate(() => {
      const tds = Array.from(document.querySelectorAll("td"));
      for (let i = 0; i < tds.length; i++) {
        const cur = tds[i];
        const next = tds[i + 1];
        if (cur && (cur.textContent || "").trim() === "Notes" && next) {
          return (next.textContent || "").trim();
        }
      }
      const tarial = Array.from(document.querySelectorAll('td.tarial11[align="left"]'));
      for (const td of tarial) {
        const txt = (td.textContent || "").trim();
        if (txt && !/^\d/.test(txt) && txt.length > 3) return txt;
      }
      return null;
    })
    .catch(() => null);

  // description (3a celda de tr.tarial11)
  const description = await page
    .$$eval("tr.tarial11", (rows) => {
      for (const r of rows) {
        const cells = Array.from(r.querySelectorAll("td"));
        if (cells.length >= 3) {
          const d = ((cells[2]?.textContent) || "").trim();
          if (d && d !== "Description") return d;
        }
      }
      return null;
    })
    .catch(() => null);

  // peso en Lb
  const pesoText = await page
    .$$eval("td", (tds) => {
      for (const td of tds) {
        const t = ((td.textContent) || "").trim();
        const m = t.match(/(\d+(?:\.\d+)?)\s*Lb/i);
        if (m) return m[1];
      }
      return null;
    })
    .catch(() => null);

  const pesoLb = parseLb(pesoText);

  // imágenes
  const imagenes = await page
    .$$eval('img[src*="foto_webcam"]', (imgs) =>
      Array.from(new Set(imgs.map((i) => i.getAttribute("src") || "").filter(Boolean)))
    )
    .catch(() => [] as string[]);

  const imagenesAbs = imagenes.map((s) => (s.startsWith("http") ? s : `${"__BASE__"}/${s.replace(/^\/+/, "")}`))
    .map((s) => s.replace("__BASE__", SISTEMA_BASE));

  return { notes, description, pesoLb, imagenes: imagenesAbs };
}

interface DatosSh {
  status: string | null;
  fecha: string | null;
  consignee: string | null;
}

async function extraerDatosSh(page: Page): Promise<DatosSh> {
  const body = (await page.innerText("body").catch(() => "")) || "";
  const norm = body.replace(/[ \t]+/g, " ");
  const status = norm.match(/Status:\s*(.+?)(?:\n|$)/i)?.[1]?.trim() ?? null;
  const fecha = norm.match(/Date:\s*(.+?)(?:\s+Status:|\n|$)/i)?.[1]?.trim() ?? null;
  const consignee = norm.match(/Consignee:\s*(.+?)(?:\n|$)/i)?.[1]?.trim() ?? null;
  return { status, fecha, consignee };
}

// Re-export para que tests / otros módulos puedan usar utilidades puras
export { Frame };
