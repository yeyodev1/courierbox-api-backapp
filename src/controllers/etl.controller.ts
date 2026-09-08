import type { Request, Response, NextFunction } from "express";
import {
  homologarPaquetes,
  listarPendientesHomologacion,
  procesarExcel,
  recalcularNombresLimpios,
} from "../services/etl.service";
import { models } from "../models/index";
import { procesarIngresoCarga, procesarIngresoManual, type Decisiones } from "../services/ingreso_carga.service";

export async function uploadExcel(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.file) {
      res.status(400).json({ error: "No se recibió ningún archivo Excel" });
      return;
    }

    const resultado = await procesarExcel(req.file.buffer);

    res.status(200).json({
      message: "Archivo procesado",
      resultado,
    });
  } catch (err: any) {
    console.error("[etl.controller] upload error:", err.message);
    res.status(500).json({ error: "Error procesando archivo", detail: err.message });
  }
}

export async function getPendientes(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const paquetes = await models.paquetes
      .find({ estado: "pendiente_validacion" })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    res.status(200).json({ paquetes });
  } catch (err: any) {
    console.error("[etl.controller] pendientes error:", err.message);
    next(err);
  }
}

/** Re-runs the name cleanup over already-imported packages. */
export async function postRecalcularNombres(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await recalcularNombresLimpios());
  } catch (err) {
    next(err);
  }
}

/** Unmatched packages grouped by consignee, with likely owners ranked. */
export async function getPendientesHomologacion(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const limite = Number(req.query.limite) || 40;
    const [grupos, totalPendientes, totalClientes] = await Promise.all([
      listarPendientesHomologacion(limite),
      models.paquetes.countDocuments({ estado: "pendiente_validacion", masterClienteId: null }),
      models.masterClientes.countDocuments(),
    ]);
    res.status(200).json({ grupos, totalPendientes, totalClientes });
  } catch (err) {
    next(err);
  }
}

/** Links a batch of unmatched packages to a client, creating it when needed. */
export async function postHomologar(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await homologarPaquetes(req.body ?? {});
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

/** Type-ahead over existing master clients for the homologation screen. */
export async function buscarClientesMaster(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const q = String(req.query.q ?? "").trim();
    if (q.length < 2) {
      res.status(200).json({ clientes: [] });
      return;
    }
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const clientes = await models.masterClientes
      .find({ $or: [{ nombreOficial: rx }, { codigoCasillero: rx }, { cedulaRuc: rx }] })
      .select("nombreOficial codigoCasillero cedulaRuc email telefono")
      .limit(20)
      .lean();
    res.status(200).json({ clientes });
  } catch (err) {
    next(err);
  }
}

/**
 * Ingreso de carga: el manifiesto por vuelo, una fila por caja.
 * Sin `?aplicar=1` sólo previsualiza — misma resolución de clientes, cero
 * escrituras — para que el operador vea qué se va a crear antes de confirmar.
 */
export async function postIngresoCarga(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.file) {
      res.status(400).json({ error: "Adjunta el archivo de Ingreso de carga (.xlsx)" });
      return;
    }
    const aplicar = ["1", "true", "si"].includes(String(req.query.aplicar ?? "").toLowerCase());

    // Viaja como texto dentro del multipart: { "WR839943": { "masterClienteId": "…" }, … }
    let decisiones: Decisiones = {};
    const crudo = req.body?.decisiones;
    if (crudo) {
      try {
        const parsed = typeof crudo === "string" ? JSON.parse(crudo) : crudo;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) decisiones = parsed;
        else throw new Error("formato");
      } catch {
        res.status(400).json({ error: "Las decisiones de vinculación no tienen un formato válido" });
        return;
      }
    }

    const resultado = await procesarIngresoCarga(req.file.buffer, {
      aplicar,
      origenNota: req.file.originalname,
      decisiones,
    });
    res.status(200).json(resultado);
  } catch (err: any) {
    if (err?.status === 400) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
}

/**
 * Ingreso de carga caja por caja, desde la pantalla. Mismo motor y misma
 * previsualización que el Excel: `?aplicar=1` escribe, sin él sólo muestra.
 * Body: { filas: [...], decisiones?: {...} }.
 */
export async function postIngresoManual(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const filas = req.body?.filas;
    if (!Array.isArray(filas) || filas.length === 0) {
      res.status(400).json({ error: "Agrega al menos una caja" });
      return;
    }
    if (filas.length > 200) {
      res.status(400).json({ error: "Máximo 200 cajas por ingreso manual; para más, usa el Excel" });
      return;
    }
    const aplicar = ["1", "true", "si"].includes(String(req.query.aplicar ?? "").toLowerCase());
    const decisiones = req.body?.decisiones && typeof req.body.decisiones === "object" && !Array.isArray(req.body.decisiones) ? (req.body.decisiones as Decisiones) : {};
    const resultado = await procesarIngresoManual(filas, { aplicar, origenNota: "ingreso manual", decisiones });
    res.status(200).json(resultado);
  } catch (err: any) {
    if (err?.status === 400) return void res.status(400).json({ error: err.message });
    next(err);
  }
}
