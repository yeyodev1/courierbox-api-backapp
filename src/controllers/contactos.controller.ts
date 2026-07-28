import type { Request, Response, NextFunction } from "express";
import { models } from "../models/index";

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function identityKey(name?: unknown, email?: unknown, phone?: unknown) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedPhone = String(phone || "").replace(/\D/g, "");
  const normalizedName = String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
  return normalizedEmail ? `email:${normalizedEmail}` : normalizedPhone ? `phone:${normalizedPhone}` : `name:${normalizedName}`;
}

function userScope(req: Request) {
  const role = String(req.user?.role || "");
  return ["admin", "gerencia", "superadmin"].includes(role) ? undefined : String(req.user?.userId || "");
}

async function combinedHistory(req: Request, query = "") {
  const asesorId = userScope(req);
  const regex = query ? new RegExp(escapeRegExp(query), "i") : null;
  const gestionFilter: Record<string, any> = asesorId ? { asesorId } : {};
  const legacyFilter: Record<string, any> = asesorId ? { asesorId } : {};
  const contactFilter: Record<string, any> = asesorId ? { creadoPor: asesorId } : {};
  if (regex) {
    legacyFilter.$or = [{ clientName: regex }, { clientEmail: regex }, { clientPhone: regex }];
    contactFilter.$or = [{ nombre: regex }, { email: regex }, { telefono: regex }];
  }

  const [gestiones, canonicalContacts] = await Promise.all([
    models.gestionesCompra.find(gestionFilter)
      .populate("contactoId", "nombre email telefono")
      .populate("asesorId", "name email")
      .sort({ createdAt: -1 })
      .lean(),
    models.contactos.find(contactFilter).sort({ updatedAt: -1 }).lean(),
  ]);

  const migratedLegacyIds = gestiones.map((gestion: any) => gestion.legacyPurchaseOrderId).filter(Boolean);
  if (migratedLegacyIds.length) legacyFilter._id = { $nin: migratedLegacyIds };
  const legacyOrders = await models.purchaseOrders.find(legacyFilter)
    .populate("asesorId", "name email")
    .sort({ createdAt: -1 })
    .lean();

  const groups = new Map<string, any>();
  const ensureGroup = (name: string, email?: string, phone?: string, contactCreatedAt?: Date) => {
    const key = identityKey(name, email, phone);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        clientName: name || "Cliente",
        clientEmail: email || "",
        clientPhone: phone || "",
        orders: [],
        asesores: new Map<string, any>(),
        contactCreatedAt,
      });
    }
    return groups.get(key);
  };

  for (const contact of canonicalContacts as any[]) {
    ensureGroup(contact.nombre, contact.email, contact.telefono, contact.createdAt);
  }

  for (const gestion of gestiones as any[]) {
    const contact = typeof gestion.contactoId === "object" ? gestion.contactoId : null;
    if (!contact) continue;
    if (regex && !regex.test(`${contact.nombre} ${contact.email || ""} ${contact.telefono || ""}`)) continue;
    const group = ensureGroup(contact.nombre, contact.email, contact.telefono);
    const asesor = typeof gestion.asesorId === "object" ? gestion.asesorId : null;
    if (asesor?._id) group.asesores.set(String(asesor._id), asesor);
    const products = Array.isArray(gestion.productos) ? gestion.productos : [];
    group.orders.push({
      _id: String(gestion._id),
      source: "gestion",
      historical: false,
      asesorId: gestion.asesorId,
      clientName: contact.nombre,
      clientEmail: contact.email,
      clientPhone: contact.telefono,
      storeName: products[0]?.tienda || gestion.paginaCompra || "Gestión de compra",
      description: products.map((product: any) => product.descripcion).filter(Boolean).join(", ") || "Gestión de compra",
      totalAmount: Number(gestion.valorTotal || 0),
      serviceType: gestion.tipoServicio,
      status: gestion.stage,
      paymentStatus: gestion.estadoPago,
      auditLog: gestion.auditLog || [],
      createdAt: gestion.createdAt,
      updatedAt: gestion.updatedAt,
    });
  }

  for (const order of legacyOrders as any[]) {
    const group = ensureGroup(order.clientName, order.clientEmail, order.clientPhone);
    const asesor = typeof order.asesorId === "object" ? order.asesorId : null;
    if (asesor?._id) group.asesores.set(String(asesor._id), asesor);
    group.orders.push({ ...order, _id: String(order._id), source: "legacy", historical: true });
  }

  return [...groups.values()].map((group) => {
    const orders = group.orders.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return {
      ...group,
      orders,
      asesores: [...group.asesores.values()],
      totalOrders: orders.length,
      totalAmount: orders.reduce((sum: number, order: any) => sum + Number(order.totalAmount || 0), 0),
      firstOrderDate: orders.at(-1)?.createdAt || group.contactCreatedAt || null,
      lastOrderDate: orders[0]?.createdAt || group.contactCreatedAt || null,
    };
  }).sort((a, b) => new Date(b.lastOrderDate || 0).getTime() - new Date(a.lastOrderDate || 0).getTime());
}

export async function listContactos(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const limit = Math.min(parseInt(String(req.query.limit || "50"), 10), 200);
    const offset = Math.max(parseInt(String(req.query.offset || "0"), 10), 0);
    const all = await combinedHistory(req, String(req.query.q || "").trim());
    const contactos = all.slice(offset, offset + limit).map(({ orders, key, ...contact }) => ({
      ...contact,
      _id: `${contact.clientName}|${contact.clientEmail || ""}|${contact.clientPhone || ""}`,
      sources: [...new Set(orders.map((order: any) => order.source))],
    }));
    res.status(200).json({ contactos, total: all.length });
  } catch (error) {
    next(error);
  }
}

export async function getContacto(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const name = String(req.query.name || "").trim();
    const email = String(req.query.email || "").trim();
    const phone = String(req.query.phone || "").trim();
    if (!name) return void res.status(400).json({ error: "name query param is required" });
    const expectedKey = identityKey(name, email, phone);
    const all = await combinedHistory(req, email || phone || name);
    const match = all.find((contact) => contact.key === expectedKey);
    if (!match) return void res.status(404).json({ error: "Contacto no encontrado" });
    const { orders, key, ...contacto } = match;
    res.status(200).json({ contacto, orders });
  } catch (error) {
    next(error);
  }
}
