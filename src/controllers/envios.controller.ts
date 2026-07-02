import type { Request, Response, NextFunction } from "express";
import { models } from "../models/index";
import { uploadEnvioEvidencia, uploadEnvioGuia } from "../services/upload.service";

function getUser(req: Request) {
  return req.user as { userId: string; email: string; role: string } | undefined;
}

function buildDateMatch(desde?: unknown, hasta?: unknown) {
  if (!desde && !hasta) return undefined;
  const match: Record<string, Date> = { };
  if (desde) match.$gte = new Date(String(desde));
  if (hasta) {
    const end = new Date(String(hasta));
    end.setHours(23, 59, 59, 999);
    match.$lte = end;
  }
  return match;
}

export async function listEnvios(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { estado, paqueteId, desde, hasta, limit, offset } = req.query;
    const query: Record<string, any> = {};
    if (estado) query.estado = estado;
    if (paqueteId) query.paqueteId = paqueteId;
    const dateMatch = buildDateMatch(desde, hasta);
    if (dateMatch) query.createdAt = dateMatch;

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
      modo,
      clienteNombre,
      clienteDireccion,
      clienteTelefono,
      numeroInvoice,
      ciudadDestino,
      proveedorUtilizado,
      valorCobrado,
      valorPagadoProveedor,
      trayectoUsa,
      trayectoLocal,
      notas,
    } = req.body;

    if (!paqueteId || !clienteNombre || !clienteDireccion) {
      res.status(400).json({ error: "paqueteId, clienteNombre, clienteDireccion are required" });
      return;
    }

    const envio = await models.enviosDomicilio.create({
      paqueteId,
      modo: modo === "interprovincial" ? "interprovincial" : "local",
      clienteNombre,
      clienteDireccion,
      clienteTelefono: clienteTelefono || "",
      numeroInvoice: numeroInvoice || "",
      ciudadDestino: ciudadDestino || "",
      proveedorUtilizado: proveedorUtilizado || "",
      valorCobrado: Number(valorCobrado) || 0,
      valorPagadoProveedor: Number(valorPagadoProveedor) || 0,
      trayectoUsa: {
        proveedorNombre: trayectoUsa?.proveedorNombre || "",
        tracking: trayectoUsa?.tracking || "",
        costo: trayectoUsa?.costo || 0,
        notas: trayectoUsa?.notas || "",
      },
      trayectoLocal: {
        proveedorNombre: trayectoLocal?.proveedorNombre || "",
        tracking: trayectoLocal?.tracking || "",
        costo: trayectoLocal?.costo || 0,
        notas: trayectoLocal?.notas || "",
      },
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

export async function uploadEnvioArchivo(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { tipo } = req.body;
    if (!req.file) {
      res.status(400).json({ error: "file is required" });
      return;
    }

    const upload = tipo === "guia" ? await uploadEnvioGuia(req.file.buffer) : await uploadEnvioEvidencia(req.file.buffer);
    const field = tipo === "guia" ? "guiaUrl" : tipo === "firma" ? "firmaUrl" : "fotoEntregaUrl";

    const envio = await models.enviosDomicilio
      .findByIdAndUpdate(req.params.id, { $set: { [field]: upload.url } }, { new: true })
      .populate("paqueteId", "wr sh trackingOriginal contenido")
      .lean();

    if (!envio) {
      res.status(404).json({ error: "Envio not found" });
      return;
    }

    res.status(200).json({ envio, upload });
  } catch (error) {
    next(error);
  }
}

export async function marcarEntregado(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = getUser(req);
    const envio = await models.enviosDomicilio
      .findByIdAndUpdate(
        req.params.id,
        {
          $set: {
            estado: "entregado",
            entregadoEn: new Date(),
            entregadoPor: user?.userId,
            evidenciaUrl: req.body.evidenciaUrl || "",
            novedad: req.body.novedad || "",
          },
        },
        { new: true }
      )
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

export async function resumenEnvios(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { desde, hasta } = _req.query;
    const dateMatch = buildDateMatch(desde, hasta);
    const match = dateMatch ? { createdAt: dateMatch } : {};

    const [locales, interprovinciales, porEstado] = await Promise.all([
      models.enviosDomicilio.aggregate([
        { $match: { ...match, modo: "local" } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            cobrados: { $sum: "$valorCobrado" },
            costo: { $sum: { $add: [{ $ifNull: ["$trayectoUsa.costo", 0] }, { $ifNull: ["$trayectoLocal.costo", 0] }] } },
            novedades: { $sum: { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ["$novedad", ""] } }, 0] }, 1, 0] } },
          },
        },
      ]),
      models.enviosDomicilio.aggregate([
        { $match: { ...match, modo: "interprovincial" } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            cobrados: { $sum: "$valorCobrado" },
            pagados: { $sum: "$valorPagadoProveedor" },
            costo: { $sum: { $add: [{ $ifNull: ["$trayectoUsa.costo", 0] }, { $ifNull: ["$trayectoLocal.costo", 0] }] } },
            novedades: { $sum: { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ["$novedad", ""] } }, 0] }, 1, 0] } },
          },
        },
      ]),
      models.enviosDomicilio.aggregate([
        { $match: match },
        { $group: { _id: "$estado", total: { $sum: 1 } } },
        { $sort: { total: -1 } },
      ]),
    ]);

    res.status(200).json({
      locales: locales[0] || { total: 0, cobrados: 0 },
      interprovinciales: interprovinciales[0] || { total: 0, cobrados: 0, pagados: 0 },
      porEstado,
      saldo: (locales[0]?.cobrados || 0) + (interprovinciales[0]?.cobrados || 0) - ((locales[0]?.costo || 0) + (interprovinciales[0]?.costo || 0) + (interprovinciales[0]?.pagados || 0)),
    });
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

export async function buscarClientes(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { q } = req.query;
    if (!q || String(q).length < 2) {
      res.status(200).json({ clientes: [] });
      return;
    }

    const regex = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const orders = await models.purchaseOrders
      .find({
        $or: [
          { clientName: regex },
          { clientEmail: regex },
          { clientPhone: regex },
        ],
      })
      .select("clientName clientEmail clientPhone createdAt")
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    // Deduplicate by name+email+phone
    const seen = new Set<string>();
    const clientes: any[] = [];
    for (const o of orders) {
      const key = `${o.clientName}|${o.clientEmail || ""}|${o.clientPhone || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      clientes.push({
        clientId: String((o as any)._id),
        clientName: o.clientName,
        clientEmail: o.clientEmail,
        clientPhone: o.clientPhone,
        lastOrderDate: o.createdAt,
      });
    }

    res.status(200).json({ clientes });
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

export async function marcarPagoEnvio(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { trayecto, pagado, fechaPago, comprobanteUrl } = req.body;
    if (!["trayectoUsa", "trayectoLocal"].includes(trayecto)) {
      res.status(400).json({ error: "trayecto must be 'trayectoUsa' or 'trayectoLocal'" });
      return;
    }

    const update: Record<string, any> = { [`${trayecto}.pagado`]: !!pagado };
    if (pagado) update[`${trayecto}.fechaPago`] = fechaPago ? new Date(fechaPago) : new Date();
    if (comprobanteUrl) update[`${trayecto}.comprobanteUrl`] = comprobanteUrl;

    const envio = await models.enviosDomicilio
      .findByIdAndUpdate(req.params.id, { $set: update }, { new: true })
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
