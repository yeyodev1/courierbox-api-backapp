import { models } from "../models/index.js";
import { getCurrentAuthUser } from "../middleware/auth.middleware.js";

export interface CreateContactoInput {
  nombre: string;
  email?: string;
  telefono?: string;
  phoneCountryCode?: string;
  cedula?: string;
  notas?: string;
  creadoPorId: string;
}

export interface ContactoResult {
  contacto: any;
  created: boolean;
  matchedOn: string[];
}

function normalizeEmail(email?: string) {
  const value = email?.trim().toLowerCase();
  return value || undefined;
}

function normalizePhone(phone?: string, countryCode?: string) {
  const digits = phone?.replace(/\D+/g, '').trim();
  if (!digits) return undefined;

  const country = countryCode?.replace(/\D+/g, '').trim();
  if (country) {
    const local = digits.replace(/^0+/, '');
    return local ? `${country}${local}` : undefined;
  }

  return digits;
}

function normalizeCedula(cedula?: string) {
  const value = cedula?.replace(/\D+/g, "").trim();
  return value || undefined;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function findDuplicateContact(input: { email?: string; telefono?: string; cedula?: string }) {
  const or: Record<string, string>[] = [];
  if (input.email) or.push({ email: input.email });
  if (input.telefono) or.push({ telefono: input.telefono });
  if (input.cedula) or.push({ cedula: input.cedula });
  if (!or.length) return null;
  return models.contactos.findOne({ $or: or }).lean();
}

export async function searchContactos(
  q: string,
  limit = 20
): Promise<{ _id: string; nombre: string; email?: string; telefono?: string; cedula?: string }[]> {
  const normalized = q.trim();
  if (!normalized) return [];

  const escaped = escapeRegex(normalized);
  const tokenRegexes = normalized
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => new RegExp(escapeRegex(token), "i"));

  const or: Record<string, any>[] = [
    { nombre: new RegExp(escaped, "i") },
    { email: new RegExp(escaped, "i") },
    { telefono: new RegExp(escaped, "i") },
    { cedula: new RegExp(escaped, "i") },
  ];

  if (normalized.includes("@")) {
    or.unshift({ email: normalized.toLowerCase() });
  }

  if (tokenRegexes.length > 1) {
    or.push({
      $and: tokenRegexes.map((regex) => ({
        $or: [{ nombre: regex }, { email: regex }, { telefono: regex }, { cedula: regex }],
      })),
    });
  }

  const results = await models.contactos
    .find({
      $or: or,
    })
    .sort({ updatedAt: -1 })
    .limit(Math.min(limit, 50))
    .select("_id nombre email telefono cedula")
    .lean();

  return results.map((c) => ({
    _id: String(c._id),
    nombre: c.nombre,
    email: c.email,
    telefono: c.telefono,
    cedula: c.cedula,
  }));
}

export async function createContacto(input: CreateContactoInput): Promise<ContactoResult> {
  const email = normalizeEmail(input.email);
  const telefono = normalizePhone(input.telefono, input.phoneCountryCode);
  const cedula = normalizeCedula(input.cedula);
  const authUser = getCurrentAuthUser() as { userId?: string; id?: string; _id?: string; email?: string } | undefined;
  const creadoPorId =
    input.creadoPorId || authUser?.userId || authUser?.id || authUser?._id || undefined;

  if (!creadoPorId) {
    throw new Error("Unauthorized: missing creator user");
  }

  const duplicate = await findDuplicateContact({ email, telefono, cedula });
  if (duplicate) {
    const matchedOn = [
      email && duplicate.email === email ? 'email' : '',
      telefono && duplicate.telefono === telefono ? 'telefono' : '',
      cedula && duplicate.cedula === cedula ? 'cedula' : '',
    ].filter(Boolean) as string[];

    const updated = await models.contactos.findByIdAndUpdate(
      duplicate._id,
      {
        $set: {
          nombre: duplicate.nombre || input.nombre.trim(),
          email: duplicate.email || email,
          telefono: duplicate.telefono || telefono,
          cedula: duplicate.cedula || cedula,
          notas: duplicate.notas || input.notas?.trim(),
        },
      },
      { new: true }
    ).lean();

    return { contacto: updated, created: false, matchedOn };
  }

  const contacto = await models.contactos.create({
    nombre: input.nombre.trim(),
    email,
    telefono,
    cedula,
    notas: input.notas?.trim(),
    creadoPor: creadoPorId,
  });

  return { contacto, created: true, matchedOn: [] };
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
  data: Partial<{ nombre: string; email: string; telefono: string; cedula: string; notas: string }>
) {
  const next = {
    ...data,
    email: normalizeEmail(data.email),
    telefono: normalizePhone(data.telefono),
    cedula: normalizeCedula(data.cedula),
  };
  return models.contactos.findByIdAndUpdate(id, { $set: next }, { new: true }).lean();
}
