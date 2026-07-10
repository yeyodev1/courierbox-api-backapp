import { models } from "../models/index.js";

export interface CreateContactoInput {
  nombre: string;
  email?: string;
  telefono?: string;
  notas?: string;
  creadoPorId: string;
}

export async function searchContactos(
  q: string,
  limit = 20
): Promise<{ _id: string; nombre: string; email?: string; telefono?: string }[]> {
  const regex = new RegExp(q, "i");
  const results = await models.contactos
    .find({
      $or: [{ nombre: regex }, { email: regex }, { telefono: regex }],
    })
    .limit(Math.min(limit, 50))
    .select("_id nombre email telefono")
    .lean();

  return results.map((c) => ({
    _id: String(c._id),
    nombre: c.nombre,
    email: c.email,
    telefono: c.telefono,
  }));
}

export async function createContacto(input: CreateContactoInput) {
  const contacto = await models.contactos.create({
    nombre: input.nombre.trim(),
    email: input.email?.trim().toLowerCase(),
    telefono: input.telefono?.trim(),
    notas: input.notas?.trim(),
    creadoPor: input.creadoPorId,
  });
  return contacto;
}

export async function listContactos(limit = 50, offset = 0) {
  const [contactos, total] = await Promise.all([
    models.contactos
      .find()
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .lean(),
    models.contactos.countDocuments(),
  ]);
  return { contactos, total };
}

export async function getContactoById(id: string) {
  return models.contactos.findById(id).lean();
}

export async function updateContacto(
  id: string,
  data: Partial<{ nombre: string; email: string; telefono: string; notas: string }>
) {
  return models.contactos.findByIdAndUpdate(id, { $set: data }, { new: true }).lean();
}
