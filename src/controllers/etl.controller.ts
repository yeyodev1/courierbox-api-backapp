import type { Request, Response, NextFunction } from "express";
import { procesarExcel } from "../services/etl.service.js";
import { models } from "../models/index.js";

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
