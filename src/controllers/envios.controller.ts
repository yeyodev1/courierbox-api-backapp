import type { Request, Response, NextFunction } from "express";
import { models } from "../models/index.js";

function getUser(req: Request) {
  return req.user as { userId: string; email: string; role: string } | undefined;
}

export async function listEnvios(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { estado, paqueteId, limit, offset } = req.query;
    const query: Record<string, any> = {};
    if (estado) query.estado = estado;
    if (paqueteId) query.paqueteId = paqueteId;

    const take = Math.min(parseInt(limit as string) || 50, 200);
    const skip = parseInt(offset as string) || 0;

    const [envios, total] = await Promise.all([
      models.enviosDomicilio
        .find(query)
        .populate("paqueteId", "wr sh trackingOriginal contenido")
        .populate("creadoPor", "name email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(take)
        .lean(),
      models.enviosDomicilio.countDocuments(query),
    ]);

    res.status(200).json({ envios, total });
  } catch (error) {
    next(error);
  }
}

export async function getEnvio(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const envio = await models.enviosDomicilio
      .findById(req.params.id)
      .populate("paqueteId", "wr sh trackingOriginal contenido")
      .populate("creadoPor", "name email")
      .lean();

    if (!envio) {
      res.status(404).json({ error: "Envio not found" });
      return;
    }
    res.status(200).json({ envio });
  } catch (error) {
    next(error);
  }
}

export async function createEnvio(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = getUser(req);
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const {
      paqueteId,
      clienteNombre,
      clienteDireccion,
      clienteTelefono,
      tipoTransportista,
      transportistaNombre,
      costoEnvio,
      trackingLocal,
      notas,
    } = req.body;

    if (!paqueteId || !clienteNombre || !clienteDireccion) {
      res.status(400).json({ error: "paqueteId, clienteNombre, clienteDireccion are required" });
      return;
    }

    const envio = await models.enviosDomicilio.create({
      paqueteId,
      clienteNombre,
      clienteDireccion,
      clienteTelefono: clienteTelefono || "",
      tipoTransportista: tipoTransportista || "externo",
      transportistaNombre: transportistaNombre || "",
      costoEnvio: costoEnvio || 0,
      trackingLocal: trackingLocal || "",
      notas: notas || "",
      creadoPor: user.userId,
    });

    res.status(201).json({ envio });
  } catch (error) {
    next(error);
  }
}

export async function updateEnvio(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const updates = req.body;
    delete updates._id;
    delete updates.creadoPor;

    const envio = await models.enviosDomicilio
      .findByIdAndUpdate(req.params.id, { $set: updates }, { new: true })
      .populate("paqueteId", "wr sh trackingOriginal contenido")
      .lean();

    if (!envio) {
      res.status(404).json({ error: "Envio not found" });
      return;
    }
    res.status(200).json({ envio });
  } catch (error) {
    next(error);
  }
}

export async function deleteEnvio(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const envio = await models.enviosDomicilio.findByIdAndDelete(req.params.id).lean();
    if (!envio) {
      res.status(404).json({ error: "Envio not found" });
      return;
    }
    res.status(200).json({ message: "Envio deleted" });
  } catch (error) {
    next(error);
  }
}

export async function buscarPaquetes(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { q } = req.query;
    if (!q) {
      res.status(400).json({ error: "q query param is required" });
      return;
    }

    const regex = new RegExp(String(q), "i");
    const paquetes = await models.paquetes
      .find({
        $or: [
          { wr: regex },
          { sh: regex },
          { trackingOriginal: regex },
          { consigneeNombre: regex },
        ],
      })
      .limit(20)
      .lean();

    res.status(200).json({ paquetes });
  } catch (error) {
    next(error);
  }
}
