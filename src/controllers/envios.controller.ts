import type { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import { models } from "../models/index";
import { uploadEnvioEvidencia, uploadEnvioGuia } from "../services/upload.service";
import { sendEntregaConfirmacion, sendEnvioEnCaminoCliente, sendCredenciales } from "../services/email.service";

function getUser(req: Request) {
  return req.user as { userId: string; email: string; role: string } | undefined;
}

function isMotorizado(user?: { role: string }) {
  return user?.role === "motorizado";
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
    const user = getUser(req);
    const { estado, paqueteId, asignadoA, desde, hasta, limit, offset } = req.query;
    const query: Record<string, any> = {};
    if (estado) query.estado = estado;
    if (paqueteId) query.paqueteId = paqueteId;

    // Motorizados only ever see the deliveries assigned to them.
    if (isMotorizado(user)) {
      query.asignadoA = user?.userId;
    } else if (asignadoA) {
      query.asignadoA = asignadoA;
    }

    const dateMatch = buildDateMatch(desde, hasta);
    if (dateMatch) query.createdAt = dateMatch;

    const take = Math.min(parseInt(limit as string) || 50, 200);
    const skip = parseInt(offset as string) || 0;

    const [envios, total] = await Promise.all([
      models.enviosDomicilio
        .find(query)
        .populate("paqueteId", "wr sh trackingOriginal contenido")
        .populate("creadoPor", "name email")
        .populate("asignadoA", "name email")
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
    const user = getUser(req);
    const envio = await models.enviosDomicilio
      .findById(req.params.id)
      .populate("paqueteId", "wr sh trackingOriginal contenido")
      .populate("creadoPor", "name email")
      .populate("asignadoA", "name email")
      .lean();

    if (!envio) {
      res.status(404).json({ error: "Envio not found" });
      return;
    }

    // Motorizados can only open their own deliveries.
    if (isMotorizado(user) && String((envio as any).asignadoA?._id ?? (envio as any).asignadoA ?? "") !== String(user?.userId)) {
      res.status(403).json({ error: "Sin acceso a este envío" });
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
      clienteEmail,
      asignadoA,
      numeroInvoice,
      ciudadDestino,
      proveedorUtilizado,
      valorCobrado,
      valorPagadoProveedor,
      trayectoUsa,
      trayectoLocal,
      notas,
    } = req.body;

    // paqueteId is now optional — a local delivery can be registered on its own.
    if (!clienteNombre || !clienteDireccion) {
      res.status(400).json({ error: "clienteNombre and clienteDireccion are required" });
      return;
    }

    // Resolve assigned motorizado name (if any) for quick display.
    let asignadoNombre = "";
    let estado: "pendiente" | "asignado" = "pendiente";
    if (asignadoA) {
      const motorizado = await models.users.findById(asignadoA).select("name email role").lean();
      if (motorizado) {
        asignadoNombre = String(motorizado.name || motorizado.email || "");
        estado = "asignado";
      }
    }

    const envio = await models.enviosDomicilio.create({
      ...(paqueteId ? { paqueteId } : {}),
      modo: modo === "interprovincial" ? "interprovincial" : "local",
      clienteNombre,
      clienteDireccion,
      clienteTelefono: clienteTelefono || "",
      clienteEmail: clienteEmail || "",
      ...(asignadoA ? { asignadoA } : {}),
      asignadoNombre,
      estado,
      numeroInvoice: numeroInvoice || "",
      ciudadDestino: ciudadDestino || "",
      proveedorUtilizado: proveedorUtilizado || "",
      valorCobrado: Number(valorCobrado) || 0,
      valorPagadoProveedor: Number(valorPagadoProveedor) || 0,
      trayectoUsa: {
        proveedorId: trayectoUsa?.proveedorId || undefined,
        proveedorNombre: trayectoUsa?.proveedorNombre || "",
        tracking: trayectoUsa?.tracking || "",
        costo: trayectoUsa?.costo || 0,
        notas: trayectoUsa?.notas || "",
      },
      trayectoLocal: {
        proveedorId: trayectoLocal?.proveedorId || undefined,
        proveedorNombre: trayectoLocal?.proveedorNombre || "",
        tracking: trayectoLocal?.tracking || "",
        costo: trayectoLocal?.costo || 0,
        notas: trayectoLocal?.notas || "",
      },
      notas: notas || "",
      creadoPor: user.userId,
    });

    // Notify the client that a guide was generated and the order is on its way.
    if (clienteEmail) {
      const esInter = envio.modo === "interprovincial";
      sendEnvioEnCaminoCliente({
        to: clienteEmail,
        clienteNombre,
        direccion: clienteDireccion,
        modo: envio.modo,
        valorCobrado: Number(valorCobrado) || 0,
        proveedor: esInter ? (proveedorUtilizado || trayectoLocal?.proveedorNombre || "") : "",
        guiaUrl: envio.guiaUrl || "",
        ciudadDestino: ciudadDestino || "",
      }).catch((err) => console.error("[envios] en-camino email error:", err));
    }

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
    const user = getUser(req);
    const { tipo } = req.body;
    if (!req.file) {
      res.status(400).json({ error: "file is required" });
      return;
    }

    // Motorizados can only upload evidence to their own deliveries.
    if (isMotorizado(user)) {
      const current = await models.enviosDomicilio.findById(req.params.id).select("asignadoA").lean();
      if (!current) {
        res.status(404).json({ error: "Envio not found" });
        return;
      }
      if (String((current as any).asignadoA ?? "") !== String(user?.userId)) {
        res.status(403).json({ error: "Sin acceso a este envío" });
        return;
      }
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

    // A motorizado can only deliver their own assignments.
    if (isMotorizado(user)) {
      const current = await models.enviosDomicilio.findById(req.params.id).select("asignadoA").lean();
      if (!current) {
        res.status(404).json({ error: "Envio not found" });
        return;
      }
      if (String((current as any).asignadoA ?? "") !== String(user?.userId)) {
        res.status(403).json({ error: "Sin acceso a este envío" });
        return;
      }
    }

    const set: Record<string, any> = {
      estado: "entregado",
      entregadoEn: new Date(),
      entregadoPor: user?.userId,
      novedad: req.body.novedad || "",
    };
    if (req.body.fotoEntregaUrl) set.fotoEntregaUrl = req.body.fotoEntregaUrl;
    if (req.body.firmaUrl) set.firmaUrl = req.body.firmaUrl;
    if (req.body.evidenciaUrl) set.evidenciaUrl = req.body.evidenciaUrl;
    if (req.body.recibidoPorNombre !== undefined) set.recibidoPorNombre = req.body.recibidoPorNombre || "";
    if (req.body.recibidoPorApellido !== undefined) set.recibidoPorApellido = req.body.recibidoPorApellido || "";
    if (req.body.recibidoPorCedula !== undefined) set.recibidoPorCedula = req.body.recibidoPorCedula || "";
    if (req.body.recibidoPorContacto !== undefined) set.recibidoPorContacto = req.body.recibidoPorContacto || "";

    const envio = await models.enviosDomicilio
      .findByIdAndUpdate(req.params.id, { $set: set }, { new: true })
      .populate("paqueteId", "wr sh trackingOriginal contenido")
      .populate("asignadoA", "name email")
      .lean();

    if (!envio) {
      res.status(404).json({ error: "Envio not found" });
      return;
    }

    // Notify the client (fire-and-forget) that their delivery was completed.
    if ((envio as any).clienteEmail) {
      sendEntregaConfirmacion({
        to: (envio as any).clienteEmail,
        clienteNombre: (envio as any).clienteNombre,
        direccion: (envio as any).clienteDireccion,
        fotoEntregaUrl: (envio as any).fotoEntregaUrl || "",
        firmaUrl: (envio as any).firmaUrl || "",
        motorizadoNombre: (envio as any).asignadoNombre || "",
        novedad: (envio as any).novedad || "",
        recibidoPor: [
          (envio as any).recibidoPorNombre,
          (envio as any).recibidoPorApellido,
        ].filter(Boolean).join(" "),
        recibidoPorCedula: (envio as any).recibidoPorCedula || "",
        recibidoPorContacto: (envio as any).recibidoPorContacto || "",
      }).catch((err) => console.error("[envios] entrega email error:", err));
    }

    res.status(200).json({ envio });
  } catch (error) {
    next(error);
  }
}

// PATCH /api/v1/envios/:id/asignar — assign a motorizado to a delivery
export async function asignarMotorizado(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { asignadoA } = req.body;
    if (!asignadoA) {
      res.status(400).json({ error: "asignadoA is required" });
      return;
    }

    const motorizado = await models.users.findById(asignadoA).select("name email role").lean();
    if (!motorizado) {
      res.status(404).json({ error: "Motorizado not found" });
      return;
    }

    const envio = await models.enviosDomicilio
      .findByIdAndUpdate(
        req.params.id,
        {
          $set: {
            asignadoA,
            asignadoNombre: String(motorizado.name || motorizado.email || ""),
            estado: "asignado",
          },
        },
        { new: true }
      )
      .populate("paqueteId", "wr sh trackingOriginal contenido")
      .populate("asignadoA", "name email")
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

// GET /api/v1/envios/motorizados — list users that can receive deliveries
export async function listMotorizados(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const motorizados = await models.users
      .find({ role: "motorizado" })
      .select("name email createdAt")
      .sort({ name: 1 })
      .lean();
    res.status(200).json({ motorizados });
  } catch (error) {
    next(error);
  }
}

// POST /api/v1/envios/motorizados — create a motorizado user (bodega/staff)
export async function createMotorizado(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { name, email, password, sendEmail } = req.body;
    if (!name || !email) {
      res.status(400).json({ error: "name and email are required" });
      return;
    }

    const existing = await models.users.findOne({ email: String(email).toLowerCase() });
    if (existing) {
      res.status(400).json({ error: "El correo ya está registrado" });
      return;
    }

    const rawPassword = String(password || Math.random().toString(36).slice(-10) + "A1");
    const passwordHash = await bcrypt.hash(rawPassword, await bcrypt.genSalt(10));

    const motorizado = await models.users.create({
      name,
      email: String(email).toLowerCase(),
      passwordHash,
      role: "motorizado",
    });

    if (sendEmail) {
      await sendCredenciales({
        to: motorizado.email,
        name: motorizado.name,
        email: motorizado.email,
        password: rawPassword,
        role: "motorizado",
        loginUrl: req.body.loginUrl || "https://courierboxlogistics.com/login",
      });
    }

    res.status(201).json({
      motorizado: { _id: motorizado._id, name: motorizado.name, email: motorizado.email },
      password: sendEmail ? undefined : rawPassword,
    });
  } catch (error) {
    next(error);
  }
}

// DELETE /api/v1/envios/motorizados/:id — remove a motorizado user (bodega/staff)
export async function deleteMotorizado(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await models.users.findById(req.params.id).select("role").lean();
    if (!user) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }
    if ((user as any).role !== "motorizado") {
      res.status(400).json({ error: "Solo se pueden eliminar usuarios motorizados desde aquí" });
      return;
    }
    await models.users.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: "Motorizado eliminado" });
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
