import type { Request, Response, NextFunction } from "express";
import { models } from "../models/index.js";

function getUser(req: Request) {
  return req.user as { userId: string; email: string; role: string } | undefined;
}

export async function listGastos(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { tipo, categoria, desde, hasta, limit, offset } = req.query;
    const query: Record<string, any> = {};
    if (tipo) query.tipo = tipo;
    if (categoria) query.categoria = categoria;
    if (desde || hasta) {
      query.fecha = {};
      if (desde) query.fecha.$gte = new Date(desde as string);
      if (hasta) query.fecha.$lte = new Date(hasta as string);
    }

    const take = Math.min(parseInt(limit as string) || 50, 200);
    const skip = parseInt(offset as string) || 0;

    const [gastos, total] = await Promise.all([
      models.gastos
        .find(query)
        .populate("creadoPor", "name email")
        .sort({ fecha: -1 })
        .skip(skip)
        .limit(take)
        .lean(),
      models.gastos.countDocuments(query),
    ]);

    res.status(200).json({ gastos, total });
  } catch (error) {
    next(error);
  }
}

export async function getGasto(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const gasto = await models.gastos.findById(req.params.id).populate("creadoPor", "name email").lean();
    if (!gasto) {
      res.status(404).json({ error: "Gasto not found" });
      return;
    }
    res.status(200).json({ gasto });
  } catch (error) {
    next(error);
  }
}

export async function createGasto(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = getUser(req);
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { tipo, categoria, monto, descripcion, fecha, proveedor, referencia, paqueteId } = req.body;

    if (!tipo || !categoria || monto === undefined || !descripcion) {
      res.status(400).json({ error: "tipo, categoria, monto, descripcion are required" });
      return;
    }

    const gasto = await models.gastos.create({
      tipo,
      categoria,
      monto,
      descripcion,
      fecha: fecha ? new Date(fecha) : new Date(),
      proveedor: proveedor || "",
      referencia: referencia || "",
      paqueteId: paqueteId || undefined,
      creadoPor: user.userId,
    });

    res.status(201).json({ gasto });
  } catch (error) {
    next(error);
  }
}

export async function updateGasto(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const updates = req.body;
    delete updates._id;
    delete updates.creadoPor;

    const gasto = await models.gastos.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true }).lean();
    if (!gasto) {
      res.status(404).json({ error: "Gasto not found" });
      return;
    }
    res.status(200).json({ gasto });
  } catch (error) {
    next(error);
  }
}

export async function deleteGasto(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const gasto = await models.gastos.findByIdAndDelete(req.params.id).lean();
    if (!gasto) {
      res.status(404).json({ error: "Gasto not found" });
      return;
    }
    res.status(200).json({ message: "Gasto deleted" });
  } catch (error) {
    next(error);
  }
}
