import * as XLSX from "xlsx";
import mongoose from "mongoose";
import { models } from "../models/index";
import type { EstadoPaquete } from "../models/paquete.model";
import { similitud } from "./fuzzy.service";
import { limpiarNombreConsignee } from "./etl.service";
import { generarCasillero } from "./casillero.service";
import { logger } from "../utils/logger";

/**
 * Ingreso de carga: el manifiesto que la bodega arma por vuelo (hoja
 * "INGRESO DE CARGA.xlsx"), una fila por caja, con el cliente escrito a mano.
 *
 * El importador de manifiestos anterior (`procesarExcel`) lee las columnas por
 * posición y exige el WR en la segunda; en esta hoja el WR es el "BOX ID" y va
 * tercero, así que importaba cero filas sin decir nada. Y nunca crea clientes:
 * todo lo que no reconoce cae a homologación manual. Este módulo hace lo que
 * el cliente pidió: lee la hoja por el nombre de cada columna, empareja el
 * nombre con un cliente existente y, si no hay ninguno, lo crea.
 *
 * Emparejamiento, en orden: mismo nombre que un cliente, un alias ya
 * resuelto, o un parecido ≥ 85 % (la misma vara que usa `matchClienteCached`).
 * Dentro de un mismo archivo, un nombre repetido crea un solo cliente.
 *
 * Previsualizar y aplicar corren la misma resolución; la diferencia es que la
 * previsualización no escribe nada, para que el operador vea qué clientes se
 * van a crear antes de confirmar.
 */

export const UMBRAL_APROXIMADO = 0.85;

/** Cabeceras aceptadas, normalizadas (mayúsculas, sin tildes, espacios simples). */
const COLUMNAS: Record<string, string[]> = {
  fecha: ["DATE", "FECHA"],
  mg: ["MASTER", "MG"],
  wr: ["BOX ID", "BOXID", "WR"],
  origen: ["ORIGEN", "ORIGIN"],
  cliente: ["CLIENTE", "CONSIGNEE", "CLIENT"],
  agencia: ["AGENCIA", "AGENCY", "SUBAGENCIA"],
  ciudad: ["CIUDAD", "CITY"],
  direccion: ["DIRECCION", "ADDRESS"],
  provincia: ["CONSIGNEE STATE", "PROVINCIA", "STATE"],
  pais: ["PAIS", "COUNTRY"],
  tracking: ["TRACKING"],
  contenido: ["DESCRIPCION", "DESCRIPTION", "CONTENIDO"],
  valor: ["PACKAGE VALUE", "VALOR", "VALUE"],
  peso: ["PESO", "WEIGHT", "PESO LB"],
  reempaque: ["REEMPAQUE", "REPACK"],
};

export interface FilaIngreso {
  /** Número de fila en la hoja, para que el error apunte a algo que el operador pueda abrir. */
  fila: number;
  fechaIngreso: Date | null;
  mg: string;
  wr: string;
  /** Lo que acompañaba al WR en la celda: "DIVIDIDO", etc. */
  notaWr: string;
  origen: string;
  clienteRaw: string;
  agencia: string;
  ciudad: string;
  direccion: string;
  provincia: string;
  pais: string;
  tracking: string;
  contenido: string;
  valorDeclarado: number;
  pesoLb: number;
  reempaque: boolean | null;
}

export type AccionCliente =
  | "existente"
  | "alias"
  | "aproximado"
  | "creado"
  | "sin_cliente";

export interface ResultadoFila {
  fila: number;
  wr: string;
  mg: string;
  fechaIngreso: string | null;
  cliente: string;
  clienteNombreOficial: string;
  casillero: string;
  agencia: string;
  contenido: string;
  pesoLb: number;
  tracking: string;
  accion: AccionCliente | "omitido" | "error";
  /** Sólo para `aproximado`: cuánto se parece y con quién. */
  score?: number;
  coincideCon?: string;
  paquete?: "nuevo" | "actualizado";
  detalle?: string;
}

export interface ResultadoIngreso {
  aplicado: boolean;
  totalFilas: number;
  clientesExistentes: number;
  clientesCreados: number;
  aproximados: number;
  sinCliente: number;
  paquetesNuevos: number;
  paquetesActualizados: number;
  omitidos: number;
  errores: string[];
  filas: ResultadoFila[];
}

// ---------------------------------------------------------------------------
// Lectura de la hoja
// ---------------------------------------------------------------------------

function normalizarCabecera(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function mapearColumnas(headerRow: unknown[]): Map<string, number> {
  const mapa = new Map<string, number>();
  headerRow.forEach((celda, idx) => {
    const nombre = normalizarCabecera(celda);
    if (!nombre) return;
    for (const [clave, variantes] of Object.entries(COLUMNAS)) {
      if (!mapa.has(clave) && variantes.includes(nombre)) mapa.set(clave, idx);
    }
  });
  return mapa;
}

/**
 * La fecha viene como texto MM/DD/YYYY (la hoja es de origen estadounidense:
 * "08/25/2026"), o como fecha real de Excel si alguien la reescribió. Se guarda
 * como el día que nombra, en UTC, igual que el resto de fechas de calendario.
 */
export function parsearFecha(raw: unknown): Date | null {
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null;
    return new Date(Date.UTC(raw.getFullYear(), raw.getMonth(), raw.getDate()));
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const parsed = XLSX.SSF.parse_date_code(raw);
    if (!parsed) return null;
    return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
  }
  const texto = String(raw ?? "").trim();
  const match = texto.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (!match) return null;
  const mes = Number(match[1]);
  const dia = Number(match[2]);
  let anio = Number(match[3]);
  if (anio < 100) anio += 2000;
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  return new Date(Date.UTC(anio, mes - 1, dia));
}

export function parsearPeso(raw: unknown): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  const match = String(raw ?? "").replace(",", ".").match(/[\d.]+/);
  return match ? parseFloat(match[0]) || 0 : 0;
}

function parsearReempaque(raw: unknown): boolean | null {
  const texto = normalizarCabecera(raw);
  if (!texto) return null;
  if (["SI", "S", "YES", "Y", "TRUE", "1"].includes(texto)) return true;
  if (["NO", "N", "FALSE", "0"].includes(texto)) return false;
  return null;
}

/** "WR846668 DIVIDIDO" → { wr: "WR846668", nota: "DIVIDIDO" }. */
export function parsearWr(raw: unknown): { wr: string; nota: string } {
  const texto = String(raw ?? "").trim();
  const match = texto.match(/(WR\s*\d+)/i);
  if (!match) return { wr: "", nota: texto };
  const wr = match[1].replace(/\s+/g, "").toUpperCase();
  const nota = texto.replace(match[1], "").replace(/\s{2,}/g, " ").trim();
  return { wr, nota };
}

function limpiarTracking(raw: unknown): string {
  return String(raw ?? "").replace(/^_+|_+$/g, "").replace(/\s+/g, "").trim();
}

export function leerIngresoCarga(buffer: Buffer): { filas: FilaIngreso[]; errores: string[] } {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw Object.assign(new Error("El archivo no tiene hojas"), { status: 400 });

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", blankrows: false });

  const headerIdx = rows.findIndex((row) => {
    const mapa = mapearColumnas(row);
    return mapa.has("wr") && mapa.has("cliente");
  });
  if (headerIdx === -1) {
    throw Object.assign(
      new Error('No encontré las columnas "BOX ID" y "CLIENTE" en la primera hoja. ¿Es el archivo de Ingreso de carga?'),
      { status: 400 }
    );
  }

  const col = mapearColumnas(rows[headerIdx]);
  const celda = (row: unknown[], clave: string): unknown => {
    const idx = col.get(clave);
    return idx === undefined ? "" : row[idx];
  };
  const texto = (row: unknown[], clave: string) => String(celda(row, clave) ?? "").replace(/\s+/g, " ").trim();

  const filas: FilaIngreso[] = [];
  const errores: string[] = [];

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const numeroFila = i + 1;
    const vacia = row.every((c) => String(c ?? "").trim() === "");
    if (vacia) continue;

    const { wr, nota } = parsearWr(celda(row, "wr"));
    if (!wr) {
      errores.push(`Fila ${numeroFila}: sin BOX ID (WR); se omitió.`);
      continue;
    }

    filas.push({
      fila: numeroFila,
      fechaIngreso: parsearFecha(celda(row, "fecha")),
      mg: texto(row, "mg").toUpperCase(),
      wr,
      notaWr: nota,
      origen: texto(row, "origen"),
      clienteRaw: texto(row, "cliente"),
      agencia: texto(row, "agencia"),
      ciudad: texto(row, "ciudad"),
      direccion: texto(row, "direccion"),
      provincia: texto(row, "provincia"),
      pais: texto(row, "pais"),
      tracking: limpiarTracking(celda(row, "tracking")),
      contenido: texto(row, "contenido"),
      valorDeclarado: parsearPeso(celda(row, "valor")),
      pesoLb: parsearPeso(celda(row, "peso")),
      reempaque: parsearReempaque(celda(row, "reempaque")),
    });
  }

  return { filas, errores };
}

// ---------------------------------------------------------------------------
// Emparejamiento de clientes
// ---------------------------------------------------------------------------

/**
 * La clave con la que se comparan nombres. Quita lo que no identifica a la
 * persona: notas de consolidación ("*WR DIVIDIDO"), la marca " MP" con que la
 * bodega etiqueta a los clientes de una subagencia, tildes y espacios dobles.
 */
export function claveNombre(raw: string): string {
  const { nombreLimpio } = limpiarNombreConsignee(raw);
  return nombreLimpio
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+MP$/, "")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** El nombre con el que se registra un cliente nuevo: limpio, sin la marca MP. */
export function nombreOficialDesde(raw: string): string {
  const { nombreLimpio } = limpiarNombreConsignee(raw);
  return nombreLimpio.replace(/\s+MP$/i, "").replace(/\s+/g, " ").trim();
}

interface ClienteCache {
  id: string;
  nombreOficial: string;
  casillero: string;
  clave: string;
}

interface AliasCache {
  masterId: string;
  clave: string;
}

interface Resolucion {
  accion: AccionCliente;
  cliente: ClienteCache | null;
  score?: number;
  coincideCon?: string;
}

class ResolutorClientes {
  private porClave = new Map<string, ClienteCache>();
  private todos: ClienteCache[] = [];
  private aliases: AliasCache[] = [];
  /** Clientes que este archivo va a crear (o creó), para no duplicar dentro del mismo lote. */
  private nuevos = new Map<string, ClienteCache>();

  constructor(clientes: ClienteCache[], aliases: AliasCache[]) {
    for (const c of clientes) {
      this.todos.push(c);
      if (c.clave && !this.porClave.has(c.clave)) this.porClave.set(c.clave, c);
    }
    this.aliases = aliases;
  }

  resolver(clienteRaw: string): Resolucion {
    const clave = claveNombre(clienteRaw);
    if (!clave) return { accion: "sin_cliente", cliente: null };

    const exacto = this.porClave.get(clave);
    if (exacto) return { accion: "existente", cliente: exacto };

    const yaNuevo = this.nuevos.get(clave);
    if (yaNuevo) return { accion: "creado", cliente: yaNuevo };

    const alias = this.aliases.find((a) => a.clave === clave);
    if (alias) {
      const dueno = this.todos.find((c) => c.id === alias.masterId);
      if (dueno) return { accion: "alias", cliente: dueno };
    }

    let mejor: { cliente: ClienteCache; score: number } | null = null;
    const candidatos = [...this.todos, ...this.nuevos.values()];
    for (const c of candidatos) {
      const score = similitud(clave, c.clave);
      if (score >= UMBRAL_APROXIMADO && (!mejor || score > mejor.score)) mejor = { cliente: c, score };
    }
    for (const a of this.aliases) {
      const score = similitud(clave, a.clave);
      if (score >= UMBRAL_APROXIMADO && (!mejor || score > mejor.score)) {
        const dueno = this.todos.find((c) => c.id === a.masterId);
        if (dueno) mejor = { cliente: dueno, score };
      }
    }
    if (mejor) {
      return {
        accion: "aproximado",
        cliente: mejor.cliente,
        score: Number(mejor.score.toFixed(3)),
        coincideCon: mejor.cliente.nombreOficial,
      };
    }

    return { accion: "creado", cliente: null };
  }

  /** Registra un cliente que el lote creará, para que las filas siguientes lo reutilicen. */
  registrarNuevo(clienteRaw: string, cliente: ClienteCache) {
    const clave = claveNombre(clienteRaw);
    this.nuevos.set(clave, cliente);
    this.todos.push(cliente);
  }
}

async function cargarResolutor(): Promise<ResolutorClientes> {
  const [clientes, aliases] = await Promise.all([
    models.masterClientes.find({}, "nombreOficial codigoCasillero").lean(),
    models.clienteAliases.find({}, "masterId variacion").lean(),
  ]);
  return new ResolutorClientes(
    (clientes as any[]).map((c) => ({
      id: String(c._id),
      nombreOficial: String(c.nombreOficial ?? ""),
      casillero: String(c.codigoCasillero ?? ""),
      clave: claveNombre(String(c.nombreOficial ?? "")),
    })),
    (aliases as any[]).map((a) => ({ masterId: String(a.masterId), clave: claveNombre(String(a.variacion ?? "")) }))
  );
}

// ---------------------------------------------------------------------------
// Proceso
// ---------------------------------------------------------------------------

/** Paquetes ya facturados o entregados no se tocan: un manifiesto reenviado no puede reabrirlos. */
const ESTADOS_CERRADOS = new Set(["facturado", "pagado", "despachado"]);

export async function procesarIngresoCarga(
  buffer: Buffer,
  opciones: { aplicar: boolean; origenNota?: string }
): Promise<ResultadoIngreso> {
  const { filas, errores } = leerIngresoCarga(buffer);
  const resolutor = await cargarResolutor();

  const resultado: ResultadoIngreso = {
    aplicado: opciones.aplicar,
    totalFilas: filas.length,
    clientesExistentes: 0,
    clientesCreados: 0,
    aproximados: 0,
    sinCliente: 0,
    paquetesNuevos: 0,
    paquetesActualizados: 0,
    omitidos: 0,
    errores: [...errores],
    filas: [],
  };

  const creadosEnLote = new Set<string>();

  for (const fila of filas) {
    const base: ResultadoFila = {
      fila: fila.fila,
      wr: fila.wr,
      mg: fila.mg,
      fechaIngreso: fila.fechaIngreso ? fila.fechaIngreso.toISOString().slice(0, 10) : null,
      cliente: fila.clienteRaw,
      clienteNombreOficial: "",
      casillero: "",
      agencia: fila.agencia,
      contenido: fila.contenido,
      pesoLb: fila.pesoLb,
      tracking: fila.tracking,
      accion: "sin_cliente",
    };

    try {
      const res = resolutor.resolver(fila.clienteRaw);
      let cliente = res.cliente;

      if (res.accion === "creado" && !cliente) {
        const nombreOficial = nombreOficialDesde(fila.clienteRaw);
        if (opciones.aplicar) {
          const creado = await models.masterClientes.create({
            codigoCasillero: await generarCasillero(),
            nombreOficial,
            subagencyId: fila.agencia,
            notas: `Creado desde Ingreso de carga${opciones.origenNota ? ` (${opciones.origenNota})` : ""}`,
          });
          cliente = {
            id: String(creado._id),
            nombreOficial: creado.nombreOficial,
            casillero: creado.codigoCasillero,
            clave: claveNombre(nombreOficial),
          };
        } else {
          cliente = { id: "", nombreOficial, casillero: "(se asignará)", clave: claveNombre(nombreOficial) };
        }
        resolutor.registrarNuevo(fila.clienteRaw, cliente);
      }

      base.accion = res.accion;
      base.score = res.score;
      base.coincideCon = res.coincideCon;
      if (cliente) {
        base.clienteNombreOficial = cliente.nombreOficial;
        base.casillero = cliente.casillero;
      }

      if (res.accion === "existente" || res.accion === "alias") resultado.clientesExistentes++;
      else if (res.accion === "aproximado") resultado.aproximados++;
      else if (res.accion === "creado") {
        // Un mismo nombre repetido en el archivo cuenta como un cliente, no como N.
        const clave = claveNombre(fila.clienteRaw);
        if (!creadosEnLote.has(clave)) {
          creadosEnLote.add(clave);
          resultado.clientesCreados++;
        }
      } else resultado.sinCliente++;

      // Recordar la grafía del manifiesto. Este importador ya la reconocería
      // por la clave, pero el de manifiestos antiguos compara el texto crudo:
      // sin el alias, "NORMA BANO MP" no le cuadra con "NORMA BANO".
      if (opciones.aplicar && cliente?.id && (res.accion === "aproximado" || res.accion === "creado")) {
        const variacion = fila.clienteRaw.trim();
        if (variacion && variacion.toUpperCase() !== cliente.nombreOficial.toUpperCase()) {
          const existe = await models.clienteAliases.findOne({
            masterId: new mongoose.Types.ObjectId(cliente.id),
            variacion: new RegExp(`^${escapeRegex(variacion)}$`, "i"),
          });
          if (!existe) {
            await models.clienteAliases.create({
              masterId: new mongoose.Types.ObjectId(cliente.id),
              variacion,
              ultimaVezVisto: new Date(),
            });
          }
        }
      }

      const existente = (await models.paquetes.findOne({ wr: fila.wr }).select("_id estado").lean()) as
        | { _id: mongoose.Types.ObjectId; estado: EstadoPaquete }
        | null;

      if (existente && ESTADOS_CERRADOS.has(existente.estado)) {
        base.accion = "omitido";
        base.detalle = `Ya está ${existente.estado}; no se modifica.`;
        resultado.omitidos++;
        resultado.filas.push(base);
        continue;
      }

      const masterClienteId = cliente?.id ? new mongoose.Types.ObjectId(cliente.id) : null;
      const doc = {
        wr: fila.wr,
        mg: fila.mg,
        trackingOriginal: fila.tracking,
        pesoLb: fila.pesoLb,
        contenido: fila.contenido,
        notas: [fila.notaWr, fila.reempaque === true ? "Reempaque" : ""].filter(Boolean).join(" | "),
        notasExtraidas: fila.notaWr,
        consigneeNombre: fila.clienteRaw,
        consigneeLimpio: cliente?.nombreOficial ?? nombreOficialDesde(fila.clienteRaw),
        subagencyId: fila.agencia,
        fechaIngreso: fila.fechaIngreso,
        origen: fila.origen,
        agencia: fila.agencia,
        ciudad: fila.ciudad,
        direccion: fila.direccion,
        valorDeclarado: fila.valorDeclarado,
        reempaque: fila.reempaque,
        masterClienteId,
        estado: (masterClienteId ? "importado" : "pendiente_validacion") as EstadoPaquete,
      };

      base.paquete = existente ? "actualizado" : "nuevo";
      if (existente) resultado.paquetesActualizados++;
      else resultado.paquetesNuevos++;

      if (opciones.aplicar) {
        if (existente) {
          await models.paquetes.updateOne({ _id: existente._id }, { $set: doc });
        } else {
          await models.paquetes.create({ ...doc, facturaId: null });
        }
      }
    } catch (err: any) {
      const msg = `Fila ${fila.fila} (${fila.wr}): ${err?.message ?? err}`;
      logger.error(`[ingreso-carga] ${msg}`);
      resultado.errores.push(msg);
      base.accion = "error";
      base.detalle = String(err?.message ?? err);
    }

    resultado.filas.push(base);
  }

  return resultado;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
