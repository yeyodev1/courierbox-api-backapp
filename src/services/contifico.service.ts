import axios, { AxiosError } from "axios";
import { env } from "../config/env";
import { logger } from "../utils/logger";
import type { EstadoSri } from "../models/factura.model";

/**
 * Cliente de la API de Contifico para la factura electrónica.
 *
 * Reemplaza un stub que mandaba un payload inventado (Bearer, camelCase, otra
 * URL base) y que, sin credenciales, "simulaba" la emisión guardando
 * `FAC-SIM-…`: ninguna factura llegó nunca a Contifico ni al SRI.
 *
 * Lo que la API hace de verdad (contifico.github.io y la cuenta de Courier Box):
 * - Autentica con `Authorization: <API_KEY>`, sin Bearer, bajo /sistema/api/v1.
 * - `POST /documento/` crea la factura; `pos` es el token del punto de venta.
 *   El número (`documento`, "001-001-000000889") lo pone el integrador y debe
 *   ser único: Courier Box sigue emitiendo a mano desde la UI de Contifico, así
 *   que aquí se toma el siguiente al último que exista, y se reintenta si chocó.
 * - Cada línea necesita un `producto_id` del catálogo; se resuelven por código.
 * - `electronico: true` + `autorizacion: ""` la registra; `PUT /documento/ID/sri/`
 *   la firma y envía al SRI, y `GET /documento/ID/estado/` dice si quedó
 *   Autorizada. Contifico además reintenta solo los pendientes cada hora.
 */

const RUC_CONSUMIDOR_FINAL = "9999999999999";
const CEDULA_CONSUMIDOR_FINAL = "9999999999";

export interface ClienteFactura {
  /** Cédula (10) o RUC (13). "9999999999999" es consumidor final. */
  identificacion: string;
  razonSocial: string;
  email?: string;
  telefono?: string;
  direccion?: string;
}

export interface LineaFactura {
  codigoProducto: string;
  cantidad: number;
  precio: number;
  /** 15 grava IVA, 0 tarifa cero, null no objeto de IVA. */
  porcentajeIva: number | null;
}

export interface EmisionInput {
  cliente: ClienteFactura;
  lineas: LineaFactura[];
  descripcion: string;
  fecha?: Date;
}

export interface DocumentoContifico {
  id: string;
  numero: string;
  estadoSri: EstadoSri;
  autorizacion: string;
  urlRide: string;
  urlXml: string;
  mensaje: string;
  raw: unknown;
}

export type EmisionResult =
  | ({ exito: true } & DocumentoContifico)
  | { exito: false; error: string; raw?: unknown };

export function estaConfigurado(): boolean {
  return Boolean(env.CONTIFICO_API_KEY && env.CONTIFICO_TOKEN);
}

const http = axios.create({
  baseURL: env.CONTIFICO_API_URL.replace(/\/+$/, ""),
  timeout: 30000,
});

function headers() {
  return { Authorization: env.CONTIFICO_API_KEY, "Content-Type": "application/json" };
}

/** Lo que Contifico devolvió, legible para el counter. */
export function describirError(err: unknown): string {
  const e = err as AxiosError<any>;
  const data = e?.response?.data;
  if (!data) return e?.message || "Error desconocido";
  if (typeof data === "string") return data.slice(0, 300);
  if (typeof data.mensaje === "string") return data.mensaje;
  if (typeof data.error === "string") return data.error;
  if (typeof data.detail === "string") return data.detail;
  if (typeof data === "object") {
    const partes = Object.entries(data).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`);
    return partes.join(" · ").slice(0, 300);
  }
  return JSON.stringify(data).slice(0, 300);
}

/** DD/MM/YYYY del día en Ecuador, que es la fecha que el SRI espera ver. */
export function fechaContifico(d: Date = new Date()): string {
  const partes = new Intl.DateTimeFormat("es-EC", {
    timeZone: "America/Guayaquil",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(d);
  const get = (t: string) => partes.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")}`;
}

const soloDigitos = (s: string) => String(s ?? "").replace(/\D+/g, "");

/**
 * El bloque `cliente` del documento. Contifico crea o reutiliza la persona por
 * identificación. Una natural con RUC lleva cédula y RUC con tipo N; una
 * sociedad (tercer dígito 6 o 9) es tipo J.
 */
export function clienteContifico(c: ClienteFactura) {
  const id = soloDigitos(c.identificacion);
  const esConsumidorFinal = id === RUC_CONSUMIDOR_FINAL || id === CEDULA_CONSUMIDOR_FINAL;
  if (esConsumidorFinal) {
    return {
      cedula: CEDULA_CONSUMIDOR_FINAL,
      ruc: RUC_CONSUMIDOR_FINAL,
      razon_social: "Consumidor Final",
      tipo: "N",
      telefonos: "",
      direccion: "",
      email: "",
      es_extranjero: false,
    };
  }
  const tercer = Number(id[2]);
  const esRuc = id.length === 13;
  const tipo = esRuc && (tercer === 6 || tercer === 9) ? "J" : "N";
  return {
    cedula: id.slice(0, 10),
    ruc: esRuc ? id : "",
    razon_social: c.razonSocial.trim().slice(0, 300),
    tipo,
    telefonos: soloDigitos(c.telefono ?? "").slice(0, 300),
    direccion: (c.direccion ?? "").trim().slice(0, 300),
    email: (c.email ?? "").trim().slice(0, 50),
    es_extranjero: false,
  };
}

const money = (n: number) => Number(n.toFixed(2));

/** Las líneas y los totales tal como Contifico los quiere, a partir de las nuestras. */
export function armarDetalles(lineas: Array<LineaFactura & { productoId: string }>) {
  let subtotalGravado = 0;
  let subtotalCero = 0;
  let iva = 0;
  const detalles = lineas.map((l) => {
    const base = money(l.cantidad * l.precio);
    const gravado = l.porcentajeIva && l.porcentajeIva > 0;
    if (gravado) {
      subtotalGravado += base;
      iva += money(base * (l.porcentajeIva! / 100));
    } else subtotalCero += base;
    return {
      producto_id: l.productoId,
      cantidad: Number(l.cantidad.toFixed(2)),
      precio: Number(l.precio.toFixed(2)),
      porcentaje_iva: l.porcentajeIva,
      porcentaje_descuento: 0,
      base_cero: l.porcentajeIva === 0 ? base : 0,
      base_gravable: gravado ? base : 0,
      base_no_gravable: l.porcentajeIva === null ? base : 0,
    };
  });
  subtotalGravado = money(subtotalGravado);
  subtotalCero = money(subtotalCero);
  iva = money(iva);
  return { detalles, subtotal_0: subtotalCero, subtotal_12: subtotalGravado, iva, total: money(subtotalGravado + subtotalCero + iva) };
}

const productoCache = new Map<string, string>();

/** Para tests y para cuando alguien cambia un código en Contifico en caliente. */
export function limpiarCacheProductos() {
  productoCache.clear();
}

/** Id del producto del catálogo por su código; falla con un mensaje accionable si no existe. */
export async function resolverProductoId(codigo: string): Promise<string> {
  const clave = codigo.trim().toUpperCase();
  const cached = productoCache.get(clave);
  if (cached) return cached;
  const { data } = await http.get("/producto/", { headers: headers(), params: { codigo: clave } });
  const lista: any[] = Array.isArray(data) ? data : [];
  const hit = lista.find((p) => String(p.codigo ?? "").toUpperCase() === clave) ?? lista[0];
  if (!hit?.id) {
    throw new Error(`El producto "${codigo}" no existe en el catálogo de Contifico. Créalo ahí (tipo servicio) o cambia CONTIFICO_PRODUCTO_*.`);
  }
  productoCache.set(clave, String(hit.id));
  return String(hit.id);
}

const prefijo = () => `${env.CONTIFICO_ESTABLECIMIENTO}-${env.CONTIFICO_PUNTO_EMISION}-`;

/**
 * Siguiente número de factura para nuestro establecimiento y punto de emisión.
 * Se pregunta a Contifico porque la numeración es compartida con lo que Courier
 * Box emite a mano; llevar una secuencia propia chocaría tarde o temprano.
 */
export async function siguienteNumero(): Promise<string> {
  const { data } = await http.get("/documento/", {
    headers: headers(),
    params: { tipo_registro: "CLI", tipo: "FAC", result_size: 50, result_page: 1 },
  });
  const lista: any[] = Array.isArray(data) ? data : data?.results ?? [];
  const pre = prefijo();
  let max = 0;
  for (const d of lista) {
    const num = String(d?.documento ?? "");
    if (!num.startsWith(pre)) continue;
    const n = parseInt(num.slice(pre.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${pre}${String(max + 1).padStart(9, "0")}`;
}

function esColisionDeNumero(err: unknown): boolean {
  const e = err as AxiosError;
  if (!e?.response || e.response.status >= 500) return false;
  const texto = JSON.stringify(e.response.data ?? "").toLowerCase();
  return /documento/.test(texto) && /(exist|duplic|unique|registrad|ya )/.test(texto);
}

export function mapearEstadoSri(estado: string): EstadoSri {
  const s = (estado ?? "").toLowerCase();
  if (s.includes("autoriz") && !s.includes("no autoriz")) return "autorizado";
  if (s.includes("rechaz") || s.includes("devuelt") || s.includes("no autoriz")) return "rechazado";
  if (s.includes("enviado")) return "enviado";
  if (s.includes("no firmado")) return "sin_enviar";
  if (s.includes("firmado")) return "firmado";
  return "sin_enviar";
}

/** Lee el documento y su estado en el SRI, y los deja en nuestra forma. */
export async function consultarDocumento(id: string): Promise<DocumentoContifico> {
  const [doc, estado] = await Promise.all([
    http.get(`/documento/${id}/`, { headers: headers() }),
    http.get(`/documento/${id}/estado/`, { headers: headers() }).catch(() => ({ data: {} as any })),
  ]);
  const d = doc.data ?? {};
  const estadoTexto = String(estado.data?.estado ?? "");
  return {
    id: String(d.id ?? id),
    numero: String(d.documento ?? ""),
    estadoSri: mapearEstadoSri(estadoTexto),
    autorizacion: String(d.autorizacion ?? ""),
    urlRide: String(d.url_ride ?? ""),
    urlXml: String(d.url_xml ?? ""),
    mensaje: estadoTexto,
    raw: { documento: d, estado: estado.data },
  };
}

/** Firma y manda al SRI. Si falla, Contifico lo reintenta solo cada hora; no es fatal. */
export async function enviarSri(id: string): Promise<{ ok: boolean; mensaje: string }> {
  try {
    const { data } = await http.put(`/documento/${id}/sri/`, undefined, { headers: headers() });
    return { ok: true, mensaje: typeof data === "string" ? data : data?.mensaje ?? "" };
  } catch (err) {
    const mensaje = describirError(err);
    logger.warn("[contifico] envío al SRI falló; Contifico lo reintentará", { id, mensaje });
    return { ok: false, mensaje };
  }
}

/**
 * Crea la factura, la manda al SRI y devuelve cómo quedó. Sin credenciales
 * devuelve una emisión simulada marcada como tal, para no fingir un número real.
 */
export async function emitirFactura(input: EmisionInput): Promise<EmisionResult> {
  if (!estaConfigurado()) {
    logger.warn("[contifico] API key o token no configurado — emisión simulada");
    return {
      exito: true,
      id: "",
      numero: `SIM-${Date.now().toString(36).toUpperCase()}`,
      estadoSri: "simulado",
      autorizacion: "",
      urlRide: "",
      urlXml: "",
      mensaje: "Contifico no está configurado; la factura no se emitió de verdad.",
      raw: { simulado: true },
    };
  }

  try {
    const lineas = [] as Array<LineaFactura & { productoId: string }>;
    for (const l of input.lineas) lineas.push({ ...l, productoId: await resolverProductoId(l.codigoProducto) });
    const totales = armarDetalles(lineas);

    const base = {
      pos: env.CONTIFICO_TOKEN,
      fecha_emision: fechaContifico(input.fecha),
      tipo_documento: "FAC",
      estado: "P",
      electronico: true,
      autorizacion: "",
      caja_id: null,
      cliente: clienteContifico(input.cliente),
      descripcion: input.descripcion.slice(0, 1000),
      subtotal_0: totales.subtotal_0,
      subtotal_12: totales.subtotal_12,
      iva: totales.iva,
      ice: 0,
      servicio: 0,
      total: totales.total,
      adicional1: "",
      adicional2: "",
      detalles: totales.detalles,
    };

    let creado: any = null;
    let numero = await siguienteNumero();
    for (let intento = 0; intento < 3; intento++) {
      try {
        const { data } = await http.post("/documento/", { ...base, documento: numero }, { headers: headers() });
        creado = data;
        break;
      } catch (err) {
        if (intento < 2 && esColisionDeNumero(err)) {
          const n = parseInt(numero.slice(prefijo().length), 10) + 1;
          numero = `${prefijo()}${String(n).padStart(9, "0")}`;
          continue;
        }
        throw err;
      }
    }

    const id = String(creado?.id ?? "");
    if (!id) return { exito: false, error: "Contifico no devolvió el id del documento", raw: creado };

    const envio = await enviarSri(id);
    const doc = await consultarDocumento(id);
    return {
      exito: true,
      ...doc,
      numero: doc.numero || String(creado.documento ?? numero),
      mensaje: doc.mensaje || envio.mensaje,
      raw: { creado, envio, ...(doc.raw as object) },
    };
  } catch (err) {
    const error = describirError(err);
    logger.error("[contifico] emisión fallida", { error });
    return { exito: false, error, raw: (err as AxiosError)?.response?.data };
  }
}

/** Registra el cobro de una factura ya emitida por API, para que Contifico deje de mostrarla pendiente. */
export async function registrarCobro(
  id: string,
  cobro: { forma: "EF" | "TRA" | "TC" | "CQ"; monto: number; comprobante?: string; fecha?: Date }
): Promise<{ ok: boolean; mensaje: string }> {
  if (!estaConfigurado() || !id) return { ok: false, mensaje: "Sin Contifico" };
  try {
    const body: Record<string, unknown> = {
      forma_cobro: cobro.forma,
      monto: money(cobro.monto).toFixed(2),
      fecha: fechaContifico(cobro.fecha),
    };
    if (cobro.comprobante) body.numero_comprobante = cobro.comprobante.slice(0, 15);
    if (cobro.forma === "TC") body.tipo_ping = "D";
    await http.post(`/documento/${id}/cobro/`, body, { headers: headers() });
    return { ok: true, mensaje: "" };
  } catch (err) {
    const mensaje = describirError(err);
    logger.warn("[contifico] no se pudo registrar el cobro", { id, mensaje });
    return { ok: false, mensaje };
  }
}

export const contificoService = {
  estaConfigurado,
  emitirFactura,
  enviarSri,
  consultarDocumento,
  registrarCobro,
  siguienteNumero,
  resolverProductoId,
};
