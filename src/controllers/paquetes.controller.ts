import type { Request, Response, NextFunction } from "express";
import { listarPaquetes, detallePaquete, datosEtiquetas } from "../services/paquetes.service";

const texto = (v: unknown) => (typeof v === "string" ? v : undefined);

export async function getPaquetes(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const q = req.query;
    const resultado = await listarPaquetes({
      q: texto(q.q),
      estado: texto(q.estado),
      agencia: texto(q.agencia),
      facturado: texto(q.facturado),
      desde: texto(q.desde),
      hasta: texto(q.hasta),
      mg: texto(q.mg),
      page: Number(q.page) || 1,
      limit: Number(q.limit) || 50,
    });
    res.status(200).json(resultado);
  } catch (err) {
    next(err);
  }
}

export async function getPaquete(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const paquete = await detallePaquete(String(req.params.id));
    if (!paquete) return void res.status(404).json({ error: "Paquete no encontrado" });
    res.status(200).json({ paquete });
  } catch (err) {
    next(err);
  }
}

/** Acepta `ids` como lista separada por comas (GET) o arreglo (POST). */
export async function getEtiquetas(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const crudo = req.body?.ids ?? req.query.ids;
    const ids = Array.isArray(crudo)
      ? crudo.map(String)
      : String(crudo ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!ids.length) return void res.status(400).json({ error: "Indica qué paquetes imprimir" });
    const paquetes = await datosEtiquetas(ids);
    res.status(200).json({ paquetes });
  } catch (err) {
    next(err);
  }
}
