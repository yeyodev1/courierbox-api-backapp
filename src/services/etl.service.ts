import * as XLSX from "xlsx";
import { models } from "../models/index";
import { similitud } from "./fuzzy.service";
import { logger } from "../utils/logger";

const UMBRAL_SIMILITUD = 0.85;

const PATRONES_LIMPIEZA = [
  /\*{2,}.*?\*{2,}/gi,
  /CLIENTE RETIRA EN BODEGA[^]*$/gi,
  /SIN COSTO DE IND AND OUT[^]*$/gi,
  /AUTORIZADO POR\s+\w+/gi,
];

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

  return { nombreLimpio: texto, notasExtraidas: notas.join(" | ") };
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
