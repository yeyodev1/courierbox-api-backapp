import type { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import { models } from "../models/index";
import { uploadEnvioEvidencia, uploadEnvioGuia } from "../services/upload.service";
import { sendCredenciales } from "../services/email.service";
import { createAndSendNotification } from "../services/notification.service";

function getUser(req: Request) {
  return req.user as { userId: string; email: string; role: string } | undefined;
}

function isMotorizado(user?: { role: string }) {
  return user?.role === "motorizado";
}

function eventUser(req: Request) {
  const user = req.user;
  return {
    userId: String(user?.userId ?? "system"),
    userName: String(user?.name ?? user?.email ?? "Sistema"),
  };
}

async function assertAssignedMotorizado(req: Request, envio: { asignadoA?: unknown }) {
  const user = getUser(req);
  return isMotorizado(user) && String(envio.asignadoA ?? "") === String(user?.userId);
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
      gestionCompraId,
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
    if (paqueteId || gestionCompraId) {
      const duplicate = await models.enviosDomicilio.findOne({
        ...(paqueteId ? { paqueteId } : {}),
        ...(gestionCompraId ? { gestionCompraId } : {}),
      }).select("_id").lean();
      if (duplicate) {
        res.status(409).json({ error: "Ya existe un envío activo para esta operación" });
        return;
      }
    }

    // Resolve assigned motorizado name (if any) for quick display.
    let asignadoNombre = "";
    let estado: "pendiente" | "asignado" = "pendiente";
    if (asignadoA) {
      const motorizado = await models.users.findById(asignadoA).select("name email role").lean();
      if (!motorizado || motorizado.role !== "motorizado") {
        res.status(400).json({ error: "El usuario asignado debe tener rol motorizado" });
        return;
      } else {
        asignadoNombre = String(motorizado.name || motorizado.email || "");
        estado = "asignado";
      }
    }

    const envio = await models.enviosDomicilio.create({
      ...(paqueteId ? { paqueteId } : {}),
      ...(gestionCompraId ? { gestionCompraId } : {}),
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
      bitacora: [{
        tipo: "envio_creado",
        estadoNuevo: estado,
        userId: user.userId,
        userName: user.email || "Usuario",
        notas: asignadoNombre ? `Asignado a ${asignadoNombre}` : "Envío pendiente de asignación",
        createdAt: new Date(),
      }],
    });

    // If this delivery comes from a purchase, advance that purchase to "en_transito".
    if (gestionCompraId) {
      try {
        await models.gestionesCompra.findByIdAndUpdate(gestionCompraId, {
          $set: {
            stage: "en_transito",
            estadoBodega: "despachada",
            estadoEntrega: estado === "asignado" ? "asignada" : "pendiente",
          },
          $push: {
            auditLog: {
              timestamp: new Date(),
              action: "envio_generado",
              userId: user.userId,
              userName: user.email || "Bodega",
              notes: `Envío generado y asignado (${asignadoNombre || "sin motorizado"})`,
            },
          },
        });
      } catch (err) {
        console.error("[envios] no se pudo actualizar stage de gestión:", err);
      }
    }

    // Local deliveries can notify immediately. Interprovincial notifications wait for the guide upload.
    if (clienteEmail && envio.modo === "local") {
      await createAndSendNotification({
        evento: "envio_en_camino",
        destinatario: clienteEmail,
        destinatarioTelefono: clienteTelefono,
        destinatarioNombre: clienteNombre,
        operacionTipo: "envio",
        operacionId: String(envio._id),
        idempotencyKey: `envio:${String(envio._id)}:envio_en_camino:creacion`,
        payload: {
          to: clienteEmail,
          clienteNombre,
          direccion: clienteDireccion,
          modo: envio.modo,
          valorCobrado: Number(valorCobrado) || 0,
          proveedor: "",
          guiaUrl: envio.guiaUrl || "",
          ciudadDestino: ciudadDestino || "",
        },
      });
    }

    res.status(201).json({ envio });
  } catch (error) {
    next(error);
  }
}

export async function updateEnvio(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const operationalFields = ["clienteNombre", "clienteDireccion", "clienteTelefono", "clienteEmail", "numeroInvoice", "ciudadDestino", "proveedorUtilizado", "notas"];
    const financialFields = ["valorCobrado", "valorPagadoProveedor", "trayectoUsa", "trayectoLocal"];
    const canEditFinancials = ["admin", "gerencia", "superadmin"].includes(String(req.user?.role || ""));
    const allowedFields = canEditFinancials ? [...operationalFields, ...financialFields] : operationalFields;
    const updates = Object.fromEntries(Object.entries(req.body || {}).filter(([key]) => allowedFields.includes(key)));
    if (!Object.keys(updates).length) {
      res.status(400).json({ error: "No hay campos editables en la solicitud" });
      return;
    }

    const envio = await models.enviosDomicilio
      .findByIdAndUpdate(req.params.id, { $set: updates }, { new: true, runValidators: true })
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

    if (!["guia", "firma", "foto"].includes(String(tipo))) {
      res.status(400).json({ error: "tipo debe ser guia, firma o foto" });
      return;
    }

    const current = await models.enviosDomicilio.findById(req.params.id).select("asignadoA estado").lean();
    if (!current) {
      res.status(404).json({ error: "Envio not found" });
      return;
    }
    if (tipo !== "guia") {
      if (!String(req.file.mimetype).startsWith("image/")) {
        res.status(400).json({ error: "La foto y la firma deben ser imágenes" });
        return;
      }
      if (!isMotorizado(user)) {
        res.status(403).json({ error: "Solo el motorizado asignado puede subir evidencia de entrega" });
        return;
      }
      if (current.estado === "entregado") {
        res.status(409).json({ error: "La evidencia de una entrega completada es inmutable" });
        return;
      }
      if (String((current as any).asignadoA ?? "") !== String(user?.userId)) {
        res.status(403).json({ error: "Sin acceso a este envío" });
        return;
      }
    }

    const upload = tipo === "guia" ? await uploadEnvioGuia(req.file.buffer) : await uploadEnvioEvidencia(req.file.buffer);
    const field = tipo === "guia" ? "guiaUrl" : tipo === "firma" ? "firmaUrl" : "fotoEntregaUrl";
    const publicIdField = tipo === "firma" ? "firmaPublicId" : tipo === "foto" ? "fotoEntregaPublicId" : null;
    const uploadFields: Record<string, string> = { [field]: upload.url };
    if (publicIdField) uploadFields[publicIdField] = upload.publicId;

    const updateQuery: Record<string, any> = tipo === "guia"
      ? { _id: String(req.params.id) }
      : { _id: String(req.params.id), estado: { $ne: "entregado" }, asignadoA: user?.userId };
    const envio = await models.enviosDomicilio
      .findOneAndUpdate(updateQuery, { $set: uploadFields }, { new: true })
      .populate("paqueteId", "wr sh trackingOriginal contenido")
      .lean();

    if (!envio) {
      res.status(409).json({ error: "El envío cambió de estado o ya no está asignado a este motorizado" });
      return;
    }

    if (tipo === "guia" && (envio as any).clienteEmail) {
      await createAndSendNotification({
        evento: "envio_en_camino",
        destinatario: (envio as any).clienteEmail,
        destinatarioTelefono: (envio as any).clienteTelefono || "",
        destinatarioNombre: (envio as any).clienteNombre || "",
        operacionTipo: "envio",
        operacionId: String((envio as any)._id),
        idempotencyKey: `envio:${String((envio as any)._id)}:envio_en_camino:guia:${upload.publicId}`,
        payload: {
          to: (envio as any).clienteEmail,
          clienteNombre: (envio as any).clienteNombre,
          direccion: (envio as any).clienteDireccion,
          modo: (envio as any).modo,
          valorCobrado: Number((envio as any).valorCobrado || 0),
          proveedor: (envio as any).proveedorUtilizado || (envio as any).trayectoLocal?.proveedorNombre || "",
          guiaUrl: (envio as any).guiaUrl || "",
          ciudadDestino: (envio as any).ciudadDestino || "",
        },
      });
    }

    res.status(200).json({ envio, upload });
  } catch (error) {
    next(error);
  }
}

export async function marcarEntregado(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = getUser(req);
    const current = await models.enviosDomicilio.findById(req.params.id).lean();
    if (!current) {
      res.status(404).json({ error: "Envio not found" });
      return;
    }
    if (!(await assertAssignedMotorizado(req, current))) {
      res.status(403).json({ error: "Sin acceso a este envío" });
      return;
    }
    if (current.estado === "entregado") {
      res.status(409).json({ error: "La entrega ya fue completada" });
      return;
    }
    if (current.estado !== "en_ruta") {
      res.status(409).json({ error: "El envío debe estar en ruta antes de entregarse" });
      return;
    }

    const fotoEntregaUrl = String(current.fotoEntregaUrl ?? "").trim();
    const firmaUrl = String(current.firmaUrl ?? "").trim();
    const recibidoPorNombre = String(req.body.recibidoPorNombre ?? "").trim();
    const recibidoPorApellido = String(req.body.recibidoPorApellido ?? "").trim();
    const recibidoPorCedula = String(req.body.recibidoPorCedula ?? "").replace(/\D+/g, "");
    if (!fotoEntregaUrl || !firmaUrl || !recibidoPorNombre || !recibidoPorApellido || recibidoPorCedula.length < 6) {
      res.status(400).json({
        error: "Foto, firma, nombre, apellido y cédula válida son obligatorios para entregar",
      });
      return;
    }

    const actor = eventUser(req);
    const entregadoEn = new Date();

    const set: Record<string, any> = {
      estado: "entregado",
      entregadoEn,
      entregadoPor: user?.userId,
      novedad: req.body.novedad || "",
      fotoEntregaUrl,
      firmaUrl,
      recibidoPorNombre,
      recibidoPorApellido,
      recibidoPorCedula,
    };
    if (req.body.evidenciaUrl) set.evidenciaUrl = req.body.evidenciaUrl;
    if (req.body.recibidoPorContacto !== undefined) set.recibidoPorContacto = req.body.recibidoPorContacto || "";

    const envio = await models.enviosDomicilio
      .findOneAndUpdate(
        { _id: req.params.id, estado: "en_ruta" },
        {
          $set: set,
          $push: {
            bitacora: {
              tipo: "entrega_completada",
              estadoAnterior: current.estado,
              estadoNuevo: "entregado",
              ...actor,
              notas: req.body.novedad || "Entrega completada con evidencia",
              evidencia: {
                fotoUrl: fotoEntregaUrl,
                firmaUrl,
                receptorNombre: `${recibidoPorNombre} ${recibidoPorApellido}`.trim(),
                receptorCedula: recibidoPorCedula,
              },
              createdAt: entregadoEn,
            },
          },
        },
        { new: true, runValidators: true }
      )
      .populate("paqueteId", "wr sh trackingOriginal contenido")
      .populate("asignadoA", "name email")
      .lean();

    if (!envio) {
      res.status(409).json({ error: "El estado del envío cambió; vuelve a cargar" });
      return;
    }

    if ((envio as any).gestionCompraId) {
      await models.gestionesCompra.findByIdAndUpdate((envio as any).gestionCompraId, {
        $set: { stage: "entregada", estado: "completado", estadoEntrega: "entregada" },
        $push: {
          auditLog: {
            timestamp: entregadoEn,
            action: "entrega_completada",
            userId: actor.userId,
            userName: actor.userName,
            notes: `Recibido por ${recibidoPorNombre} ${recibidoPorApellido}`,
          },
        },
      });
    }

    // Persist and attempt the delivery email before returning the operation result.
    let notificationResult: { estado: string; ultimoError?: string } | null = null;
    if ((envio as any).clienteEmail) {
      const linkedGestion = (envio as any).gestionCompraId
        ? await models.gestionesCompra.findById((envio as any).gestionCompraId).select("viewToken").lean()
        : null;
      const evidenceBase = linkedGestion?.viewToken
        ? `${req.protocol}://${req.get("host")}/api/v1/gestiones-compra/view/${linkedGestion.viewToken}/evidence`
        : "";
      const notification = await createAndSendNotification({
        evento: "entrega_completada",
        destinatario: (envio as any).clienteEmail,
        destinatarioTelefono: (envio as any).clienteTelefono || "",
        destinatarioNombre: (envio as any).clienteNombre || "",
        operacionTipo: "envio",
        operacionId: String((envio as any)._id),
        payload: {
          to: (envio as any).clienteEmail,
          clienteNombre: (envio as any).clienteNombre,
          direccion: (envio as any).clienteDireccion,
          fotoEntregaUrl: evidenceBase ? `${evidenceBase}/foto` : "",
          firmaUrl: evidenceBase ? `${evidenceBase}/firma` : "",
          motorizadoNombre: (envio as any).asignadoNombre || "",
          novedad: (envio as any).novedad || "",
          recibidoPor: [(envio as any).recibidoPorNombre, (envio as any).recibidoPorApellido].filter(Boolean).join(" "),
          recibidoPorCedula: (envio as any).recibidoPorCedula || "",
          recibidoPorContacto: (envio as any).recibidoPorContacto || "",
        },
      });
      notificationResult = { estado: notification.estado, ultimoError: notification.ultimoError };
      await models.enviosDomicilio.findByIdAndUpdate((envio as any)._id, {
        $push: {
          bitacora: {
            tipo: notification.estado === "enviada" ? "correo_entrega_enviado" : "correo_entrega_fallido",
            userId: "system",
            userName: "Sistema",
            notas: notification.estado === "enviada" ? "Comprobante enviado por correo" : String(notification.ultimoError || "Correo fallido"),
            createdAt: new Date(),
          },
        },
      });
    }

    res.status(200).json({ envio, notificacion: notificationResult });
  } catch (error) {
    next(error);
  }
}

export async function iniciarRuta(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const current = await models.enviosDomicilio.findById(req.params.id).lean();
    if (!current) {
      res.status(404).json({ error: "Envio not found" });
      return;
    }
    if (!(await assertAssignedMotorizado(req, current))) {
      res.status(403).json({ error: "Sin acceso a este envío" });
      return;
    }
    if (!["asignado", "reprogramado"].includes(current.estado)) {
      res.status(409).json({ error: "Solo un envío asignado o reprogramado puede iniciar ruta" });
      return;
    }
    const actor = eventUser(req);
    const envio = await models.enviosDomicilio.findOneAndUpdate(
      { _id: req.params.id, estado: current.estado },
      {
        $set: { estado: "en_ruta" },
        $push: { bitacora: { tipo: "ruta_iniciada", estadoAnterior: current.estado, estadoNuevo: "en_ruta", ...actor, notas: req.body.notas || "Ruta iniciada", createdAt: new Date() } },
      },
      { new: true, runValidators: true }
    ).lean();
    if (envio?.gestionCompraId) {
      await models.gestionesCompra.findByIdAndUpdate(envio.gestionCompraId, { $set: { estadoEntrega: "en_ruta" } });
    }
    res.status(200).json({ envio });
  } catch (error) {
    next(error);
  }
}

export async function marcarFallido(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const motivo = String(req.body.motivo ?? "").trim();
    if (!motivo) {
      res.status(400).json({ error: "El motivo de la entrega fallida es obligatorio" });
      return;
    }
    const current = await models.enviosDomicilio.findById(req.params.id).lean();
    if (!current) {
      res.status(404).json({ error: "Envio not found" });
      return;
    }
    if (!(await assertAssignedMotorizado(req, current))) {
      res.status(403).json({ error: "Sin acceso a este envío" });
      return;
    }
    if (!["asignado", "en_ruta"].includes(current.estado)) {
      res.status(409).json({ error: "La entrega no puede marcarse fallida en su estado actual" });
      return;
    }
    const actor = eventUser(req);
    const envio = await models.enviosDomicilio.findOneAndUpdate(
      { _id: req.params.id, estado: current.estado },
      {
        $set: { estado: "fallido", novedad: motivo },
        $push: { bitacora: { tipo: "entrega_fallida", estadoAnterior: current.estado, estadoNuevo: "fallido", ...actor, notas: motivo, createdAt: new Date() } },
      },
      { new: true, runValidators: true }
    ).lean();
    if (envio?.gestionCompraId) {
      await models.gestionesCompra.findByIdAndUpdate(envio.gestionCompraId, { $set: { estadoEntrega: "fallida" } });
    }
    res.status(200).json({ envio });
  } catch (error) {
    next(error);
  }
}

export async function reprogramarEnvio(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const motivo = String(req.body.motivo ?? "").trim();
    const current = await models.enviosDomicilio.findById(req.params.id).lean();
    if (!current) {
      res.status(404).json({ error: "Envio not found" });
      return;
    }
    if (current.estado !== "fallido") {
      res.status(409).json({ error: "Solo una entrega fallida puede reprogramarse" });
      return;
    }
    const actor = eventUser(req);
    const envio = await models.enviosDomicilio.findOneAndUpdate(
      { _id: req.params.id, estado: "fallido" },
      {
        $set: { estado: "reprogramado" },
        $push: { bitacora: { tipo: "entrega_reprogramada", estadoAnterior: "fallido", estadoNuevo: "reprogramado", ...actor, notas: motivo || "Entrega reprogramada", createdAt: new Date() } },
      },
      { new: true, runValidators: true }
    ).lean();
    if (envio?.gestionCompraId) {
      await models.gestionesCompra.findByIdAndUpdate(envio.gestionCompraId, { $set: { estadoEntrega: "reprogramada" } });
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
    if (!motorizado || motorizado.role !== "motorizado") {
      res.status(404).json({ error: "Motorizado not found" });
      return;
    }

    const envio = await models.enviosDomicilio
      .findOneAndUpdate(
        { _id: req.params.id, estado: { $in: ["pendiente", "asignado", "reprogramado"] } },
        {
          $set: {
            asignadoA,
            asignadoNombre: String(motorizado.name || motorizado.email || ""),
            estado: "asignado",
          },
          $push: {
            bitacora: {
              tipo: "motorizado_asignado",
              estadoNuevo: "asignado",
              ...eventUser(req),
              notas: `Asignado a ${String(motorizado.name || motorizado.email || "")}`,
              createdAt: new Date(),
            },
          },
        },
        { new: true }
      )
      .populate("paqueteId", "wr sh trackingOriginal contenido")
      .populate("asignadoA", "name email")
      .lean();

    if (!envio) {
      res.status(409).json({ error: "No se puede asignar un envío en ruta, entregado o fallido sin reprogramarlo" });
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
    const [contacts, orders] = await Promise.all([
      models.contactos.find({
        $or: [
          { nombre: regex },
          { email: regex },
          { telefono: regex },
        ],
      }).select("nombre email telefono updatedAt").sort({ updatedAt: -1 }).limit(20).lean(),
      models.purchaseOrders.find({
        $or: [
          { clientName: regex },
          { clientEmail: regex },
          { clientPhone: regex },
        ],
      }).select("clientName clientEmail clientPhone createdAt").sort({ createdAt: -1 }).limit(20).lean(),
    ]);

    // Deduplicate by name+email+phone
    const seen = new Set<string>();
    const clientes: any[] = [];
    for (const contact of contacts) {
      const key = `${String(contact.email || "").toLowerCase()}|${String(contact.telefono || "").replace(/\D/g, "")}|${String(contact.nombre).toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      clientes.push({
        clientId: String(contact._id),
        clientName: contact.nombre,
        clientEmail: contact.email,
        clientPhone: contact.telefono,
        lastOrderDate: contact.updatedAt,
        source: "contacto",
      });
    }
    for (const o of orders) {
      const key = `${String(o.clientEmail || "").toLowerCase()}|${String(o.clientPhone || "").replace(/\D/g, "")}|${String(o.clientName).toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      clientes.push({
        clientId: String((o as any)._id),
        clientName: o.clientName,
        clientEmail: o.clientEmail,
        clientPhone: o.clientPhone,
        lastOrderDate: o.createdAt,
        source: "legacy",
      });
    }

    res.status(200).json({ clientes: clientes.slice(0, 20) });
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
