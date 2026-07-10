import type { Request, Response, NextFunction } from "express";
import * as GestionCompraService from "../services/gestion_compra.service.js";
import { uploadGestionCompraImagen } from "../services/upload.service.js";
import { models } from "../models/index.js";

const ADMIN_ROLES = ["admin", "superadmin", "gerencia"];

async function resolveUserIdentity(user: any) {
  const userId = String(user?.userId ?? user?.id ?? user?._id ?? "").trim();
  const email = String(user?.email ?? "").trim().toLowerCase();
  const directName = String(user?.name ?? user?.fullName ?? "").trim();

  if (userId) {
    const dbUser = await models.users.findById(userId).select("name email").lean();
    if (dbUser) {
      return {
        userId: String(dbUser._id),
        userName: String(dbUser.name || dbUser.email || directName || email || "Usuario"),
      };
    }

    return {
      userId,
      userName: directName || email || "Usuario",
    };
  }

  if (email) {
    const dbUser = await models.users.findOne({ email }).select("name email").lean();
    if (dbUser) {
      return {
        userId: String(dbUser._id),
        userName: String(dbUser.name || dbUser.email || "Usuario"),
      };
    }
  }

  return null;
}

function getRole(user: any) {
  return String(user?.role ?? "").trim();
}

function getObjectIdString(value: unknown) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    const maybeId = (value as { _id?: unknown; id?: unknown })._id ?? (value as { _id?: unknown; id?: unknown }).id;
    return String(maybeId ?? "");
  }
  return String(value);
}

// GET /api/v1/gestiones-compra
export async function listGestiones(req: Request, res: Response, next: NextFunction) {
  try {
    const role = getRole(req.user);
    const auth = await resolveUserIdentity(req.user);
    if (!auth || !role) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const page = parseInt(String(req.query.page ?? "1"));
    const limit = parseInt(String(req.query.limit ?? "20"));
    const estado = req.query.estado ? String(req.query.estado) : undefined;
    const asesorId = req.query.asesorId ? String(req.query.asesorId) : undefined;
    const mes = req.query.mes ? parseInt(String(req.query.mes)) : undefined;
    const año = req.query.año ? parseInt(String(req.query.año)) : undefined;

    const result = await GestionCompraService.listGestiones(role, auth.userId, {
      page,
      limit,
      estado,
      asesorId: ADMIN_ROLES.includes(role) ? asesorId : undefined,
      mes,
      año,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
}

// POST /api/v1/gestiones-compra
export async function createGestion(req: Request, res: Response, next: NextFunction) {
  try {
    const role = getRole(req.user);
    const auth = await resolveUserIdentity(req.user);
    if (!auth || !role) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const body = req.body;

    // If asesor, force asesorId to self
    const asesorId = ADMIN_ROLES.includes(role)
      ? (body.asesorId ?? auth.userId)
      : auth.userId;

    if (!asesorId || !auth.userId || !auth.userName) {
      res.status(401).json({ error: "Unauthorized: missing user identity" });
      return;
    }

    const gestion = await GestionCompraService.createGestionCompra({
      asesorId,
      contactoId: body.contactoId,
      valorTotal: Number(body.valorTotal),
      valorReserva: Number(body.valorReserva ?? 0),
      cuentaBancariaId: body.cuentaBancariaId,
      costoVenta: Number(body.costoVenta ?? 0),
      valorComision: Number(body.valorComision ?? 0),
      feeConfigId: body.feeConfigId,
      paginaCompra: body.paginaCompra,
      fechaEntregaTentativa: body.fechaEntregaTentativa,
      imagenCompraUrl: body.imagenCompraUrl,
      notas: body.notas,
      createdByUserId: auth.userId,
      createdByUserName: auth.userName,
    });

    res.status(201).json({ gestion });
  } catch (err) {
    next(err);
  }
}

// GET /api/v1/gestiones-compra/stats/mensual
export async function getStatsMensuales(req: Request, res: Response, next: NextFunction) {
  try {
    const role = getRole(req.user);
    const auth = await resolveUserIdentity(req.user);
    if (!auth || !role) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const now = new Date();
    const año = parseInt(String(req.query.año ?? now.getFullYear()));
    const mes = parseInt(String(req.query.mes ?? now.getMonth() + 1));
    const asesorId = req.query.asesorId ? String(req.query.asesorId) : undefined;

    const targetAsesorId = ADMIN_ROLES.includes(role) ? (asesorId || undefined) : auth.userId;

    const stats = await GestionCompraService.getEstadisticasMensuales(
      año,
      mes,
      targetAsesorId
    );

    res.json(stats);
  } catch (err) {
    next(err);
  }
}

// GET /api/v1/gestiones-compra/view/:token (public — no auth)
export async function getByToken(req: Request, res: Response, next: NextFunction) {
  try {
    const gestion = await GestionCompraService.getGestionByViewToken(String(req.params.token));
    if (!gestion) return res.status(404).json({ error: "Gestión no encontrada" });
    res.json({ gestion });
  } catch (err) {
    next(err);
  }
}

// GET /api/v1/gestiones-compra/:id
export async function getGestion(req: Request, res: Response, next: NextFunction) {
  try {
    const role = getRole(req.user);
    const auth = await resolveUserIdentity(req.user);
    if (!auth || !role) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const gestion = await GestionCompraService.getGestionById(String(req.params.id));
    if (!gestion) return res.status(404).json({ error: "Gestión no encontrada" });

    // Asesor can only see own
    if (!ADMIN_ROLES.includes(role) && getObjectIdString(gestion.asesorId) !== auth.userId) {
      return res.status(403).json({ error: "Sin acceso a esta gestión" });
    }

    res.json({ gestion });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/v1/gestiones-compra/:id
export async function updateGestion(req: Request, res: Response, next: NextFunction) {
  try {
    const role = getRole(req.user);
    const auth = await resolveUserIdentity(req.user);
    if (!auth || !role) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const existing = await GestionCompraService.getGestionById(String(req.params.id));
    if (!existing) return res.status(404).json({ error: "Gestión no encontrada" });

    if (!ADMIN_ROLES.includes(role) && getObjectIdString(existing.asesorId) !== auth.userId) {
      return res.status(403).json({ error: "Sin acceso" });
    }

    const updated = await GestionCompraService.updateGestion(
      String(req.params.id),
      role,
      req.body,
      auth.userId,
      auth.userName
    );

    res.json({ gestion: updated });
  } catch (err) {
    next(err);
  }
}

// POST /api/v1/gestiones-compra/:id/confirmar-reserva (admin only)
export async function confirmarReserva(req: Request, res: Response, next: NextFunction) {
  try {
    const auth = await resolveUserIdentity(req.user);
    if (!auth) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const gestion = await GestionCompraService.confirmarReserva(String(req.params.id), auth.userId, auth.userName);
    if (!gestion) return res.status(404).json({ error: "Gestión no encontrada" });
    res.json({ gestion });
  } catch (err) {
    next(err);
  }
}

// POST /api/v1/gestiones-compra/:id/notificar (re-enviar)
export async function reNotificar(req: Request, res: Response, next: NextFunction) {
  try {
    await GestionCompraService.sendNotificacionCliente(String(req.params.id));
    res.json({ ok: true, message: "Notificación reenviada" });
  } catch (err) {
    next(err);
  }
}

// GET /api/v1/gestiones-compra/comision-preview?valorTotal=&feeConfigId=
export async function comisionPreview(req: Request, res: Response, next: NextFunction) {
  try {
    const valorTotal = Number(String(req.query.valorTotal ?? "0"));
    const feeConfigId = req.query.feeConfigId ? String(req.query.feeConfigId) : undefined;

    if (isNaN(valorTotal) || valorTotal <= 0) {
      return res.status(400).json({ error: "valorTotal inválido" });
    }

    const result = await GestionCompraService.calcularComisionPreview(valorTotal, feeConfigId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

// POST /api/v1/gestiones-compra/upload-imagen (multipart)
export async function uploadImagen(req: Request, res: Response, next: NextFunction) {
  try {
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) return res.status(400).json({ error: "No se recibió archivo" });

    const result = await uploadGestionCompraImagen(file.buffer);

    res.json({ url: result.url });
  } catch (err) {
    next(err);
  }
}
