import type { Request, Response, NextFunction } from "express";
import {
  homologarPaquetes,
  listarPendientesHomologacion,
  procesarExcel,
  recalcularNombresLimpios,
} from "../services/etl.service";
import { models } from "../models/index";

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
