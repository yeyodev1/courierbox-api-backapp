import mongoose from "mongoose";
import { models } from "../models/index";

/**
 * Catálogo de Courier Box y sus couriers aliados: cómo sale la etiqueta de
 * cada uno y si tiene tarifa por libra propia. Arranca con los 10 formatos que
 * la bodega usaba en Multitrack; de ahí en adelante lo maneja el admin.
 */

export interface AliadoDatos {
  _id?: string;
  codigo: string;
  nombre: string;
  marca: string;
  logoUrl: string;
  pie: string[];
  lema: string;
  barrasAbajo: boolean;
  rotuloTracking: string;
  coincidencias: string[];
  tarifaFleteLb: number | null;
  tarifaArancelLb: number | null;
  principal: boolean;
  activo: boolean;
  orden: number;
}

const base = { logoUrl: "", lema: "", barrasAbajo: false, rotuloTracking: "", tarifaFleteLb: null, tarifaArancelLb: null, principal: false, activo: true };

export const ALIADOS_DEFECTO: AliadoDatos[] = [
  { ...base, codigo: "COURIERBOX", nombre: "Courier Box", marca: "COURIER BOX", pie: ["IG courierbox_ec", "WA +1 347 824 8937"], coincidencias: ["COURIER BOX", "CBOX"], principal: true, orden: 0 },
  { ...base, codigo: "GRACIABOX", nombre: "Gracia Box", marca: "GRACIA", pie: ["Instagram: gracia.ec", "WhatsApp: +593 99 988 7278"], lema: "Del mundo a tu puerta", coincidencias: ["GRACIA"], orden: 1 },
  { ...base, codigo: "SUNSET", nombre: "Sunset Express", marca: "SUNSET EXPRESS", pie: [], coincidencias: ["SUNSET"], orden: 2 },
  { ...base, codigo: "AVCCOURIER", nombre: "AVC Courier", marca: "AVC COURIER", pie: [], barrasAbajo: true, coincidencias: ["AVC"], orden: 3 },
  { ...base, codigo: "QUIKCARGO", nombre: "Quik Cargo", marca: "QUIK CARGO", pie: [], barrasAbajo: true, coincidencias: ["QUIK", "QUICK"], orden: 4 },
  { ...base, codigo: "MIMALETA", nombre: "Mi Maleta", marca: "MI MALETA", pie: [], barrasAbajo: true, rotuloTracking: "No. TRACKING", coincidencias: ["MI MALETA"], orden: 5 },
  { ...base, codigo: "TELOTRAEMOS", nombre: "Te lo traemos", marca: "TE LO TRAEMOS", pie: ["WA: +593 98 220 9762"], lema: "Entregas rápidas y seguras", coincidencias: ["TE LO TRAEMOS"], orden: 6 },
  { ...base, codigo: "SHIPIT", nombre: "Ship It", marca: "SHIP IT", pie: [], coincidencias: ["SHIP IT"], orden: 7 },
  { ...base, codigo: "EASYCOURIER", nombre: "Easy Courier", marca: "EASY COURIER", pie: [], coincidencias: ["EASY COURIER"], orden: 8 },
  { ...base, codigo: "FASTCOURIER", nombre: "Fast Courier", marca: "FAST COURIER", pie: [], coincidencias: ["FAST COURIER"], orden: 9 },
];

/** Sin tildes, espacios ni signos: "Gracia  Box" y "GRACIABOX" son lo mismo. */
export const normalizarAgencia = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");

/**
 * El aliado de una caja según la AGENCIA del manifiesto. Lo que no coincide
 * con ningún aliado es de Courier Box (el principal). El frontend repite esta
 * misma regla para elegir la etiqueta.
 */
export function aliadoDeAgencia<T extends Pick<AliadoDatos, "coincidencias" | "principal" | "activo">>(
  agencia: unknown,
  aliados: T[]
): T | null {
  const activos = aliados.filter((a) => a.activo !== false);
  const principal = activos.find((a) => a.principal) ?? null;
  const a = normalizarAgencia(agencia);
  if (!a) return principal;
  for (const al of activos) {
    if (al.principal) continue;
    if ((al.coincidencias ?? []).some((c) => normalizarAgencia(c) && a.includes(normalizarAgencia(c)))) return al;
  }
  return principal;
}

let cache: { aliados: AliadoDatos[]; leidoEn: number } | null = null;
const CACHE_MS = 30_000;

export function limpiarCacheAliados() {
  cache = null;
}

/** La primera vez que alguien los pide, se cargan los formatos de siempre. */
async function sembrarSiVacio() {
  if ((await models.aliados.countDocuments({})) > 0) return;
  try {
    await models.aliados.insertMany(ALIADOS_DEFECTO, { ordered: false });
  } catch {
    // Dos pedidos a la vez: el segundo choca con el índice único y no pasa nada.
  }
}

export async function listarAliados(): Promise<AliadoDatos[]> {
  await sembrarSiVacio();
  const docs = await models.aliados.find({}).sort({ orden: 1, nombre: 1 }).lean();
  return docs.map((d) => ({ ...(d as unknown as AliadoDatos), _id: String(d._id) }));
}

/** Para facturar: los aliados activos, con un caché corto para no leerlos en cada caja. */
export async function aliadosParaTarifas(): Promise<AliadoDatos[]> {
  if (cache && Date.now() - cache.leidoEn < CACHE_MS) return cache.aliados;
  const aliados = (await listarAliados()).filter((a) => a.activo);
  cache = { aliados, leidoEn: Date.now() };
  return aliados;
}

const err = (message: string, status = 400) => Object.assign(new Error(message), { status });

const textoLimpio = (v: unknown, max = 120) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);

function lista(v: unknown, max: number): string[] {
  const arr = Array.isArray(v) ? v : String(v ?? "").split(/[\n,]/);
  return arr.map((x) => textoLimpio(x)).filter(Boolean).slice(0, max);
}

/** Vacío = usa la tarifa base. Si viene, tiene que ser un precio razonable. */
function tarifa(v: unknown, campo: string): number | null {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Number(String(v).replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n > 100) throw err(`${campo}: escribe un valor entre 0 y 100, o déjalo vacío para usar la tarifa base`);
  return Math.round(n * 100) / 100;
}

/** Sólo los campos editables, validados. `parcial` deja fuera lo que no vino. */
function limpiar(d: Record<string, unknown>, parcial: boolean): Partial<AliadoDatos> {
  const out: Partial<AliadoDatos> = {};
  const vino = (k: string) => !parcial || d[k] !== undefined;
  if (vino("nombre")) {
    out.nombre = textoLimpio(d.nombre, 60);
    if (!out.nombre) throw err("Escribe el nombre del aliado");
  }
  if (vino("marca")) out.marca = textoLimpio(d.marca, 40).toUpperCase();
  if (vino("logoUrl")) {
    const url = String(d.logoUrl ?? "").trim();
    if (url && !/^https:\/\//i.test(url)) throw err("El logo tiene que ser un enlace https");
    out.logoUrl = url;
  }
  if (vino("pie")) out.pie = lista(d.pie, 3);
  if (vino("lema")) out.lema = textoLimpio(d.lema, 80);
  if (vino("barrasAbajo")) out.barrasAbajo = Boolean(d.barrasAbajo);
  if (vino("rotuloTracking")) out.rotuloTracking = textoLimpio(d.rotuloTracking, 20).toUpperCase();
  if (vino("coincidencias")) out.coincidencias = lista(d.coincidencias, 10).map((c) => c.toUpperCase());
  if (vino("tarifaFleteLb")) out.tarifaFleteLb = tarifa(d.tarifaFleteLb, "Flete por libra");
  if (vino("tarifaArancelLb")) out.tarifaArancelLb = tarifa(d.tarifaArancelLb, "Arancel por libra");
  if (vino("activo")) out.activo = d.activo === undefined ? true : Boolean(d.activo);
  if (d.orden !== undefined && Number.isFinite(Number(d.orden))) out.orden = Math.floor(Number(d.orden));
  return out;
}

export async function crearAliado(d: Record<string, unknown>, usuario = "") {
  const datos = limpiar(d, false);
  const codigo = normalizarAgencia(d.codigo || datos.nombre).slice(0, 30);
  if (!codigo) throw err("Escribe el nombre del aliado");
  if (await models.aliados.exists({ codigo })) throw err(`Ya existe un aliado con el código ${codigo}`, 409);
  if (!datos.marca) datos.marca = String(datos.nombre).toUpperCase();
  if (!datos.coincidencias?.length) datos.coincidencias = [String(datos.nombre).toUpperCase()];
  const creado = await models.aliados.create({ ...datos, codigo, principal: false, actualizadoPor: usuario });
  limpiarCacheAliados();
  return creado.toObject();
}

export async function actualizarAliado(id: string, d: Record<string, unknown>, usuario = "") {
  if (!mongoose.isValidObjectId(id)) throw err("Aliado no encontrado", 404);
  const actual = await models.aliados.findById(id).lean();
  if (!actual) throw err("Aliado no encontrado", 404);
  const datos = limpiar(d, true);
  // Courier Box es el respaldo de toda caja sin aliado: no se apaga.
  if (actual.principal) datos.activo = true;
  const actualizado = await models.aliados
    .findByIdAndUpdate(id, { $set: { ...datos, actualizadoPor: usuario } }, { new: true })
    .lean();
  limpiarCacheAliados();
  return actualizado;
}
