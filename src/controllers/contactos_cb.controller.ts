import type { Request, Response, NextFunction } from "express";
import * as ContactoService from "../services/contacto.service.js";
import { models } from "../models/index.js";

async function resolveCreatorId(req: Request): Promise<string | null> {
  const user = req.user as { userId?: string; id?: string; _id?: string; email?: string } | undefined;
  const directId = user?.userId ?? user?.id ?? user?._id;
  if (directId) return String(directId);

  const email = user?.email?.trim().toLowerCase();
  if (!email) return null;

  const matched = await models.users.findOne({ email }).select("_id").lean();
  return matched ? String(matched._id) : null;
}

// GET /api/v1/contactos-cb?q=&limit=
export async function searchContactos(req: Request, res: Response, next: NextFunction) {
  try {
    const q = String(req.query.q ?? "");
    const limit = parseInt(String(req.query.limit ?? "20"));
    const contactos = await ContactoService.searchContactos(q, limit);
    res.json({ contactos });
  } catch (err) {
    next(err);
  }
}

// GET /api/v1/contactos-cb/list
export async function listContactos(req: Request, res: Response, next: NextFunction) {
  try {
    const limit = parseInt(String(req.query.limit ?? "50"));
    const offset = parseInt(String(req.query.offset ?? "0"));
    const result = await ContactoService.listContactos(limit, offset);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

// GET /api/v1/contactos-cb/:id
export async function getContacto(req: Request, res: Response, next: NextFunction) {
  try {
    const contacto = await ContactoService.getContactoById(String(req.params.id));
    if (!contacto) return res.status(404).json({ error: "Contacto no encontrado" });
    res.json({ contacto });
  } catch (err) {
    next(err);
  }
}

// POST /api/v1/contactos-cb
export async function createContacto(req: Request, res: Response, next: NextFunction) {
  try {
    const { nombre, email, telefono, phoneCountryCode, cedula, notas } = req.body;
    const userId = await resolveCreatorId(req);

    if (!nombre?.trim()) {
      return res.status(400).json({ error: "El nombre es requerido" });
    }

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const result = await ContactoService.createContacto({
      nombre,
      email,
      telefono,
      phoneCountryCode,
      cedula,
      notas,
      creadoPorId: String(userId),
    });

    res.status(result.created ? 201 : 200).json({ ...result });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/v1/contactos-cb/:id
export async function updateContacto(req: Request, res: Response, next: NextFunction) {
  try {
    const { nombre, email, telefono, cedula, notas } = req.body;
    const contacto = await ContactoService.updateContacto(String(req.params.id), {
      nombre,
      email,
      telefono,
      cedula,
      notas,
    });
    if (!contacto) return res.status(404).json({ error: "Contacto no encontrado" });
    res.json({ contacto });
  } catch (err) {
    next(err);
  }
}
