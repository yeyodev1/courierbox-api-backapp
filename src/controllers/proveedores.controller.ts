import type { Request, Response, NextFunction } from "express";
import { models } from "../models/index.js";
import { canonicalProveedorNombre, normalizeProveedorNombre } from "../services/proveedor-normalize.js";

function mergeDefined<T extends Record<string, any>>(target: T, source: Partial<T>) {
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && value !== null && value !== "") {
      (target as Record<string, any>)[key] = value;
    }
  }
  return target;
}

export async function listProveedores(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { q, limit, offset } = req.query;
    const query: Record<string, any> = {};

    if (q) {
      const regex = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      query.$or = [
        { nombre: regex },
        { tipo: regex },
        { pais: regex },
        { ciudad: regex },
        { contacto: regex },
      ];
    }

    const take = Math.min(parseInt(limit as string) || 50, 200);
    const skip = parseInt(offset as string) || 0;

    const [proveedores, total] = await Promise.all([
      models.proveedores.find(query).sort({ nombre: 1 }).skip(skip).limit(take).lean(),
      models.proveedores.countDocuments(query),
    ]);

    res.status(200).json({ proveedores, total });
  } catch (error) {
    next(error);
  }
}

export async function getProveedor(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const proveedor = await models.proveedores.findById(req.params.id).lean();
    if (!proveedor) {
      res.status(404).json({ error: "Proveedor not found" });
      return;
    }
    res.status(200).json({ proveedor });
  } catch (error) {
    next(error);
  }
}

export async function createProveedor(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { nombre, tipo, pais, ciudad, contacto, telefono, email, notas } = req.body;
    if (!nombre) {
      res.status(400).json({ error: "nombre is required" });
      return;
    }

    const nombreNormalizado = normalizeProveedorNombre(nombre);
    const nombreCanonico = canonicalProveedorNombre(nombre);
    const existing = await models.proveedores.findOne({ nombreNormalizado }).lean();

    if (existing) {
      const proveedor = await models.proveedores
        .findByIdAndUpdate(
          existing._id,
          {
            $set: mergeDefined(
              {
                nombre: existing.nombre || nombreCanonico,
                nombreNormalizado,
                tipo: existing.tipo || tipo || "",
                pais: existing.pais || pais || "",
                ciudad: existing.ciudad || ciudad || "",
                contacto: existing.contacto || contacto || "",
                telefono: existing.telefono || telefono || "",
                email: existing.email || email || "",
                notas: existing.notas || notas || "",
              },
              {}
            ),
          },
          { new: true }
        )
        .lean();

      res.status(200).json({ proveedor, merged: true });
      return;
    }

    const proveedor = await models.proveedores.create({
      nombre: nombreCanonico,
      nombreNormalizado,
      tipo: tipo || "",
      pais: pais || "",
      ciudad: ciudad || "",
      contacto: contacto || "",
      telefono: telefono || "",
      email: email || "",
      notas: notas || "",
    });

    res.status(201).json({ proveedor });
  } catch (error) {
    next(error);
  }
}

export async function updateProveedor(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const updates = req.body;
    delete updates._id;

    if (typeof updates.nombre === "string") {
      updates.nombre = canonicalProveedorNombre(updates.nombre);
      updates.nombreNormalizado = normalizeProveedorNombre(updates.nombre);
    }

    if (updates.nombreNormalizado) {
      const collision = await models.proveedores.findOne({
        nombreNormalizado: updates.nombreNormalizado,
        _id: { $ne: req.params.id },
      }).lean();

      if (collision) {
        const proveedor = await models.proveedores
          .findByIdAndUpdate(
            collision._id,
            { $set: mergeDefined({ ...collision, ...updates, nombre: updates.nombre || collision.nombre }, updates) },
            { new: true }
          )
          .lean();

        await models.proveedores.findByIdAndDelete(req.params.id).lean();
        res.status(200).json({ proveedor, merged: true });
        return;
      }
    }

    const proveedor = await models.proveedores.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true }).lean();
    if (!proveedor) {
      res.status(404).json({ error: "Proveedor not found" });
      return;
    }
    res.status(200).json({ proveedor });
  } catch (error) {
    next(error);
  }
}

export async function deleteProveedor(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const proveedor = await models.proveedores.findByIdAndDelete(req.params.id).lean();
    if (!proveedor) {
      res.status(404).json({ error: "Proveedor not found" });
      return;
    }
    res.status(200).json({ message: "Proveedor deleted" });
  } catch (error) {
    next(error);
  }
}
