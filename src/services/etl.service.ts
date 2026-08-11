import * as XLSX from "xlsx";
import mongoose from "mongoose";
import { models } from "../models/index";
import { similitud } from "./fuzzy.service";
import { logger } from "../utils/logger";

const UMBRAL_SIMILITUD = 0.85;

const PATRONES_LIMPIEZA = [
  /\*{2,}.*?\*{2,}/gi,
  /CLIENTE RETIRA EN BODEGA[^]*$/gi,
  /SIN COSTO DE IND AND OUT[^]*$/gi,
  /AUTORIZADO POR\s+\w+/gi,
  // Consolidation notes travel in the same cell as the name. Left in, they made
  // "LALLEZKA ZAVALA", "LALLEZKA ZAVALA *WR DIVIDIDO" and
  // "LALLEZKA ZAVALA *WR PPAL WR825" read as three different people. Dropping
  // them collapses ~950 of the ~2,900 distinct names in the current manifest.
  /\*?\s*WR\s*(?:PPAL|PRINCIPAL|DIVIDIDO)\b[^]*/gi,
  /\bWR\d{5,}\b/gi,
  /\bGRUPO\b/gi,
];

/** Warehouse range codes such as "00039 - 48324" are not names. */
const PATRON_SOLO_NUMEROS = /^[\d\s\-]+$/;

const PATRON_NOMBRE_PREFIJO = /^(.*?)\s{2,}/;

const PATRON_SUBAGENCIA_COL0 = /^Normbre:\s*(.+?)\s+idConsignee:\s*(\d+)/i;

const PREFIJOS_SUBAGENCIA = [
  "FARMAR VL /",
  "GRACIA BOX /",
  "VG COURIER",
  "CBOX EXPRESS",
  "SMART COURIER",
];

interface RawRow {
  rawNombreEmpresa: string;
  idConsignee: string;
  wr: string;
  sh: string;
  mg: string;
  status: string;
  notaGeneral: string;
  peso: string;
  contenido: string;
  instrucciones: string;
  tracking: string;
}

function parsePeso(pesoRaw: string): number {
  const match = pesoRaw.match(/^([\d.]+)/);
  return match ? parseFloat(match[1]) : 0;
}

function limpiarTracking(raw: string): string {
  return raw.replace(/^_+|_+$/g, "").trim();
}

function limpiarNombreConsignee(raw: string): { nombreLimpio: string; notasExtraidas: string } {
  let texto = raw.trim();
  const notas: string[] = [];

  for (const pat of PATRONES_LIMPIEZA) {
    const match = texto.match(pat);
    if (match) {
      notas.push(match[0].trim());
      texto = texto.replace(pat, "").trim();
    }
  }

  const pipeIdx = texto.indexOf("||");
  if (pipeIdx !== -1) {
    const partes = texto.split("||");
    texto = partes[0].trim();
    for (let i = 1; i < partes.length; i++) {
      notas.push(partes[i].trim());
    }
  }

  // Leftover asterisks and doubled spaces otherwise split the same person into
  // several groups on the homologation screen.
  texto = texto.replace(/\*+/g, " ").replace(/\s{2,}/g, " ").trim();

  if (PATRON_SOLO_NUMEROS.test(texto)) {
    notas.push(texto);
    texto = "";
  }

  return { nombreLimpio: texto, notasExtraidas: notas.join(" | ") };
}

/**
 * Recomputes `consigneeLimpio` for packages already imported, so the cleanup
 * improvements above apply to the existing manifest without a re-import. The
 * raw value stays in `consigneeNombre`, so this is always recomputable.
 */
export async function recalcularNombresLimpios(): Promise<{
  revisados: number;
  actualizados: number;
  nombresAntes: number;
  nombresDespues: number;
}> {
  const paquetes = await models.paquetes
    .find({ masterClienteId: null })
    .select("consigneeNombre consigneeLimpio")
    .lean();

  const antes = new Set<string>();
  const despues = new Set<string>();
  const ops: Array<{ updateOne: { filter: object; update: object } }> = [];

  for (const p of paquetes as any[]) {
    antes.add(String(p.consigneeLimpio || p.consigneeNombre || "").trim().toUpperCase());

    const { nombreLimpio } = limpiarNombreConsignee(String(p.consigneeNombre ?? ""));
    const { nombre } = detectarSubagency(nombreLimpio);
    despues.add(nombre.trim().toUpperCase());

    if (nombre !== p.consigneeLimpio) {
      ops.push({ updateOne: { filter: { _id: p._id }, update: { $set: { consigneeLimpio: nombre } } } });
    }
  }

  if (ops.length > 0) {
    for (let i = 0; i < ops.length; i += 1000) {
      await models.paquetes.bulkWrite(ops.slice(i, i + 1000));
    }
  }

  return {
    revisados: paquetes.length,
    actualizados: ops.length,
    nombresAntes: antes.size,
    nombresDespues: despues.size,
  };
}

function detectarSubagency(nombre: string): { nombre: string; subagencyId: string } {
  const upper = nombre.toUpperCase();
  for (const prefijo of PREFIJOS_SUBAGENCIA) {
    if (upper.startsWith(prefijo.toUpperCase())) {
      return { nombre: nombre.slice(prefijo.length).trim(), subagencyId: prefijo };
    }
  }
  return { nombre, subagencyId: "" };
}

function parseEmpresaCol0(raw: string): { rawNombreEmpresa: string; idConsignee: string } {
  const match = raw.match(PATRON_SUBAGENCIA_COL0);
  if (match) {
    return { rawNombreEmpresa: match[1].trim(), idConsignee: match[2] };
  }
  return { rawNombreEmpresa: raw, idConsignee: "" };
}

function extraerFilas(buffer: Buffer): RawRow[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows: Record<string, string>[] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    blankrows: false,
  }) as Record<string, string>[];

  const headerRowIndex = rows.findIndex((r: any) => {
    const vals = Object.values(r).map(String);
    return vals.some((v) => /WR\d+/i.test(v));
  });

  if (headerRowIndex === -1) {
    throw new Error("No se encontró fila de encabezados en el Excel");
  }

  const headers: string[] = [
    "rawNombreEmpresa",
    "wr",
    "sh",
    "mg",
    "status",
    "notaGeneral",
    "peso",
    "contenido",
    "instrucciones",
    "tracking",
  ];

  const result: RawRow[] = [];
  for (let i = headerRowIndex; i < rows.length; i++) {
    const row = rows[i] as any;
    const vals = Object.values(row).map(String);
    if (vals.length < 4) continue;
    const wr = vals[1] || "";
    if (!/WR\d+/i.test(wr)) continue;

    const { rawNombreEmpresa, idConsignee } = parseEmpresaCol0(vals[0] || "");

    result.push({
      rawNombreEmpresa,
      idConsignee,
      wr,
      sh: (vals[2] || "").toUpperCase().trim(),
      mg: vals[3] || "",
      status: vals[4] || "",
      notaGeneral: vals[5] || "",
      peso: vals[6] || "",
      contenido: vals[7] || "",
      instrucciones: vals[8] || "",
      tracking: limpiarTracking(vals[9] || ""),
    });
  }

  return result;
}

async function matchClienteCached(
  row: RawRow,
  cacheAliases: Array<{ masterId: string; variacion: string }>,
  cacheCasilleros: Map<string, string>
): Promise<{
  masterId: string | null;
  estado: "importado" | "pendiente_validacion";
}> {
  if (row.sh && row.sh !== "SH000000" && row.sh !== "SH0") {
    const cached = cacheCasilleros.get(row.sh);
    if (cached) {
      return { masterId: cached, estado: "importado" };
    }
  }

  if (!row.notaGeneral.trim()) {
    return { masterId: null, estado: "pendiente_validacion" };
  }

  const { nombreLimpio } = limpiarNombreConsignee(row.notaGeneral);
  const { nombre } = detectarSubagency(nombreLimpio);
  if (!nombre) {
    return { masterId: null, estado: "pendiente_validacion" };
  }

  const upper = nombre.toUpperCase();
  let mejorMatch: { masterId: string; score: number } | null = null;

  for (const alias of cacheAliases) {
    const score = similitud(upper, alias.variacion.toUpperCase());
    if (score >= UMBRAL_SIMILITUD && (!mejorMatch || score > mejorMatch.score)) {
      mejorMatch = { masterId: alias.masterId, score };
    }
  }

  if (mejorMatch) {
    const existe = cacheAliases.some(
      (a) => a.masterId === mejorMatch!.masterId && a.variacion.toUpperCase() === upper
    );
    if (!existe) {
      await models.clienteAliases.create({
        masterId: mejorMatch.masterId,
        variacion: nombre,
        ultimaVezVisto: new Date(),
      });
      cacheAliases.push({ masterId: mejorMatch.masterId, variacion: nombre });
    }
    return { masterId: mejorMatch.masterId, estado: "importado" };
  }

  return { masterId: null, estado: "pendiente_validacion" };
}

/**
 * Homologation.
 *
 * `matchClienteCached` can only match against master clients and aliases that
 * already exist, and it never creates one. On a fresh database every row lands
 * in `pendiente_validacion` with a null `masterClienteId`, and nothing
 * downstream — invoicing, counter pickup — can touch those packages. These
 * helpers close that loop: an operator resolves each unmatched name once, and
 * the alias created here makes every later import match on its own.
 */

export interface PendienteGrupo {
  /** Cleaned consignee name shared by the packages in this group. */
  nombre: string;
  paquetes: Array<{
    _id: string;
    wr: string;
    sh: string;
    trackingOriginal: string;
    contenido: string;
    pesoLb: number;
    consigneeNombre: string;
    createdAt: Date;
  }>;
  totalPaquetes: number;
  totalPesoLb: number;
  sugerencias: Array<{
    masterId: string;
    nombreOficial: string;
    codigoCasillero: string;
    cedulaRuc: string;
    score: number;
  }>;
}

/**
 * Groups unmatched packages by cleaned name and ranks likely owners.
 *
 * Counts come from an aggregation over the whole collection, not from a sample:
 * homologating a group touches every package with that name, so the number on
 * screen has to be the number that will actually move.
 */
/**
 * Filter for one consignee bucket, matching how the aggregation grouped them.
 * The "SIN NOMBRE" bucket is the rows with no usable name at all, so it cannot
 * be matched by that literal string.
 */
function filtroPorNombre(nombre: string): Record<string, unknown> {
  const limpio = nombre.trim();
  if (!limpio || limpio.toUpperCase() === "SIN NOMBRE") {
    return {
      $and: [
        { $or: [{ consigneeLimpio: { $in: ["", null] } }, { consigneeLimpio: { $exists: false } }] },
        { $or: [{ consigneeNombre: { $in: ["", null] } }, { consigneeNombre: { $exists: false } }] },
      ],
    };
  }
  const rx = new RegExp(`^${escapeRegex(limpio)}$`, "i");
  return { $or: [{ consigneeLimpio: rx }, { consigneeNombre: rx }] };
}

export async function listarPendientesHomologacion(limitGrupos = 40): Promise<PendienteGrupo[]> {
  const base = { estado: "pendiente_validacion" as const, masterClienteId: null };

  const agregados = (await models.paquetes.aggregate([
    { $match: base },
    {
      $group: {
        _id: {
          $toUpper: {
            $trim: {
              input: {
                $ifNull: [
                  { $cond: [{ $eq: ["$consigneeLimpio", ""] }, null, "$consigneeLimpio"] },
                  { $ifNull: ["$consigneeNombre", "SIN NOMBRE"] },
                ],
              },
            },
          },
        },
        totalPaquetes: { $sum: 1 },
        totalPesoLb: { $sum: { $ifNull: ["$pesoLb", 0] } },
      },
    },
    { $sort: { totalPaquetes: -1 } },
    { $limit: limitGrupos },
  ])) as Array<{ _id: string; totalPaquetes: number; totalPesoLb: number }>;

  const ordenados: PendienteGrupo[] = [];
  for (const row of agregados) {
    const nombre = row._id || "SIN NOMBRE";
    // A readable sample per group; the counts above cover the full set.
    const muestra = (await models.paquetes
      .find({ ...base, ...filtroPorNombre(nombre) } as never)
      .select("wr sh trackingOriginal contenido pesoLb consigneeNombre createdAt")
      .sort({ createdAt: -1 })
      .limit(12)
      .lean()) as any[];

    ordenados.push({
      nombre,
      totalPaquetes: row.totalPaquetes,
      totalPesoLb: Number(row.totalPesoLb) || 0,
      sugerencias: [],
      paquetes: muestra.map((p) => ({
        _id: String(p._id),
        wr: p.wr,
        sh: p.sh,
        trackingOriginal: p.trackingOriginal,
        contenido: p.contenido,
        pesoLb: Number(p.pesoLb) || 0,
        consigneeNombre: p.consigneeNombre,
        createdAt: p.createdAt,
      })),
    });
  }

  const clientes = (await models.masterClientes
    .find({}, "nombreOficial codigoCasillero cedulaRuc")
    .lean()) as any[];

  for (const grupo of ordenados) {
    grupo.sugerencias = clientes
      .map((c) => ({
        masterId: String(c._id),
        nombreOficial: c.nombreOficial ?? "",
        codigoCasillero: c.codigoCasillero ?? "",
        cedulaRuc: c.cedulaRuc ?? "",
        score: similitud(grupo.nombre, String(c.nombreOficial ?? "").toUpperCase()),
      }))
      .filter((s) => s.score >= 0.55)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }

  return ordenados;
}

export interface HomologarInput {
  /** Explicit package ids, or every pending package sharing `nombre`. */
  paqueteIds?: string[];
  nombre?: string;
  masterClienteId?: string;
  nuevoCliente?: {
    codigoCasillero: string;
    nombreOficial: string;
    cedulaRuc?: string;
    email?: string;
    telefono?: string;
  };
}

export async function homologarPaquetes(input: HomologarInput) {
  const badRequest = (message: string) => Object.assign(new Error(message), { status: 400 });

  let masterId = input.masterClienteId;

  if (!masterId) {
    const nuevo = input.nuevoCliente;
    if (!nuevo?.codigoCasillero?.trim() || !nuevo?.nombreOficial?.trim()) {
      throw badRequest("Indica un cliente existente o el casillero y nombre del nuevo cliente");
    }

    const codigoCasillero = nuevo.codigoCasillero.trim().toUpperCase();

    // The casillero is the unique key, so reuse rather than collide.
    const existente = await models.masterClientes.findOne({ codigoCasillero }).lean();
    if (existente) {
      masterId = String((existente as any)._id);
    } else {
      // Guard the identity the proposal calls "validación estricta": one
      // cédula/RUC must not spawn a second account.
      const cedula = nuevo.cedulaRuc?.trim();
      if (cedula) {
        const porCedula = await models.masterClientes.findOne({ cedulaRuc: cedula }).lean();
        if (porCedula) {
          throw Object.assign(
            new Error(
              `Esa cédula/RUC ya pertenece a ${(porCedula as any).nombreOficial} (${(porCedula as any).codigoCasillero}). Vincula a ese cliente en vez de crear uno nuevo.`
            ),
            { status: 409 }
          );
        }
      }

      const creado = await models.masterClientes.create({
        codigoCasillero,
        nombreOficial: nuevo.nombreOficial.trim(),
        cedulaRuc: cedula ?? "",
        email: nuevo.email?.trim() ?? "",
        telefono: nuevo.telefono?.trim() ?? "",
      });
      masterId = String(creado._id);
    }
  }

  if (!mongoose.isValidObjectId(masterId)) throw badRequest("Cliente inválido");

  const filtro: Record<string, unknown> = { estado: "pendiente_validacion", masterClienteId: null };
  if (input.paqueteIds?.length) {
    const ids = input.paqueteIds.filter((id) => mongoose.isValidObjectId(id));
    if (!ids.length) throw badRequest("Ningún paquete válido en la selección");
    filtro._id = { $in: ids };
  } else if (input.nombre?.trim()) {
    // Same bucket definition the listing used, so the operator homologates
    // exactly the packages the screen counted.
    Object.assign(filtro, filtroPorNombre(input.nombre));
  } else {
    throw badRequest("Indica los paquetes o el nombre a homologar");
  }

  const result = await models.paquetes.updateMany(filtro as never, {
    $set: { masterClienteId: new mongoose.Types.ObjectId(masterId), estado: "validado" },
  });

  // Remember the spelling we just resolved so the next import matches by itself.
  if (input.nombre?.trim()) {
    const variacion = input.nombre.trim();
    const yaExiste = await models.clienteAliases.findOne({
      masterId: new mongoose.Types.ObjectId(masterId),
      variacion: new RegExp(`^${escapeRegex(variacion)}$`, "i"),
    });
    if (!yaExiste) {
      await models.clienteAliases.create({
        masterId: new mongoose.Types.ObjectId(masterId),
        variacion,
        ultimaVezVisto: new Date(),
      });
    }
  }

  const cliente = await models.masterClientes.findById(masterId).lean();
  return { homologados: result.modifiedCount, cliente };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface EtlResult {
  total: number;
  importados: number;
  pendientes: number;
  errores: string[];
}

export async function procesarExcel(buffer: Buffer): Promise<EtlResult> {
  const filas = extraerFilas(buffer);
  const resultado: EtlResult = { total: filas.length, importados: 0, pendientes: 0, errores: [] };

  const [clientes, clientesConCasillero] = await Promise.all([
    models.masterClientes.find({}).lean(),
    models.masterClientes.find({}, "codigoCasillero").lean(),
  ]);
  const cacheAliases: Array<{ masterId: string; variacion: string }> = [];
  const rawAliases = await models.clienteAliases.find().lean();
  for (const a of rawAliases as any[]) {
    cacheAliases.push({ masterId: a.masterId.toString(), variacion: a.variacion });
  }
  const cacheCasilleros = new Map<string, string>(
    (clientesConCasillero as any[]).map((c) => [c.codigoCasillero, c._id.toString()])
  );

  const batch: any[] = [];
  const BATCH_SIZE = 500;

  for (const [idx, row] of filas.entries()) {
    try {
      const { nombreLimpio, notasExtraidas } = limpiarNombreConsignee(row.notaGeneral);
      const { nombre: nombreSinAgency, subagencyId } = detectarSubagency(nombreLimpio);

      const subagencyCol0 = PREFIJOS_SUBAGENCIA.find(
        (p) => row.rawNombreEmpresa.toUpperCase().includes(p.toUpperCase())
      );
      const finalSubagencyId = subagencyId || subagencyCol0 || "";

      const { masterId, estado } = await matchClienteCached(row, cacheAliases, cacheCasilleros);

      batch.push({
        wr: row.wr,
        sh: row.sh,
        mg: row.mg,
        trackingOriginal: row.tracking,
        pesoLb: parsePeso(row.peso),
        contenido: row.contenido,
        statusProveedor: row.status,
        notas: row.notaGeneral,
        notasExtraidas,
        consigneeNombre: row.notaGeneral,
        consigneeLimpio: nombreSinAgency,
        subagencyId: finalSubagencyId,
        masterClienteId: masterId,
        estado,
        facturaId: null,
      });

      if (estado === "importado") {
        resultado.importados++;
      } else {
        resultado.pendientes++;
      }
    } catch (err: any) {
      const msg = `Error en fila ${row.wr}: ${err.message}`;
      logger.error(msg);
      resultado.errores.push(msg);
    }

    if (batch.length >= BATCH_SIZE || idx === filas.length - 1) {
      await models.paquetes.insertMany(batch, { ordered: false });
      batch.length = 0;
    }
  }

  return resultado;
}
