import type { Request, Response, NextFunction } from "express";
import * as ContactoService from "../services/contacto.service.js";

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
    const { nombre, email, telefono, notas } = req.body;
    if (!nombre?.trim()) {
      return res.status(400).json({ error: "El nombre es requerido" });
    }

    const contacto = await ContactoService.createContacto({
      nombre,
      email,
      telefono,
      notas,
      creadoPorId: req.user.id,
    });

    res.status(201).json({ contacto });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/v1/contactos-cb/:id
export async function updateContacto(req: Request, res: Response, next: NextFunction) {
  try {
    const { nombre, email, telefono, notas } = req.body;
    const contacto = await ContactoService.updateContacto(String(req.params.id), {
      nombre,
      email,
      telefono,
      notas,
    });
    if (!contacto) return res.status(404).json({ error: "Contacto no encontrado" });
    res.json({ contacto });
  } catch (err) {
    next(err);
  }
}
