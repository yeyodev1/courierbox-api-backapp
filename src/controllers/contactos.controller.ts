import type { Request, Response, NextFunction } from "express";
import { models } from "../models/index";

export async function listContactos(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { q, limit, offset } = req.query;
    const take = Math.min(parseInt(limit as string) || 50, 200);
    const skip = parseInt(offset as string) || 0;

    const match: Record<string, any> = {};
    if (q) {
      const regex = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      match.$or = [
        { clientName: regex },
        { clientEmail: regex },
        { clientPhone: regex },
      ];
    }

    const pipeline: any[] = [
      { $match: match },
      {
        $group: {
          _id: { name: "$clientName", email: "$clientEmail", phone: "$clientPhone" },
          clientName: { $first: "$clientName" },
          clientEmail: { $first: "$clientEmail" },
          clientPhone: { $first: "$clientPhone" },
          totalOrders: { $sum: 1 },
          totalAmount: { $sum: "$totalAmount" },
          lastOrderDate: { $max: "$createdAt" },
          firstOrderDate: { $min: "$createdAt" },
          asesores: { $addToSet: "$asesorId" },
          orderIds: { $push: "$_id" },
        },
      },
      { $sort: { lastOrderDate: -1 } },
      { $skip: skip },
      { $limit: take },
    ];

    const contactos = await models.purchaseOrders.aggregate(pipeline);

    const asesorIds = [...new Set(contactos.flatMap((c: any) => c.asesores))];
    const asesores = await models.users
      .find({ _id: { $in: asesorIds } })
      .select("name email")
      .lean();
    const asesorMap = new Map(asesores.map((a: any) => [String(a._id), a]));

    const enriched = contactos.map((c: any) => ({
      _id: `${c._id.name}|${c._id.email || ""}|${c._id.phone || ""}`,
      clientName: c.clientName,
      clientEmail: c.clientEmail,
      clientPhone: c.clientPhone,
      totalOrders: c.totalOrders,
      totalAmount: c.totalAmount,
      lastOrderDate: c.lastOrderDate,
      firstOrderDate: c.firstOrderDate,
      asesores: (c.asesores || []).map((id: any) => asesorMap.get(String(id)) || { name: "Unknown" }),
    }));

    const countResult = await models.purchaseOrders.aggregate([
      { $match: match },
      {
        $group: {
          _id: { name: "$clientName", email: "$clientEmail", phone: "$clientPhone" },
        },
      },
      { $count: "total" },
    ]);

    const total = countResult.length > 0 ? countResult[0].total : 0;

    res.status(200).json({ contactos: enriched, total });
  } catch (error) {
    next(error);
  }
}

export async function getContacto(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { name, email, phone } = req.query;

    if (!name) {
      res.status(400).json({ error: "name query param is required" });
      return;
    }

    const match: Record<string, any> = { clientName: String(name) };
    if (email) match.clientEmail = String(email);
    if (phone) match.clientPhone = String(phone);

    const orders = await models.purchaseOrders
      .find(match)
      .populate("asesorId", "name email")
      .sort({ createdAt: -1 })
      .lean();

    if (orders.length === 0) {
      res.status(404).json({ error: "Contacto no encontrado" });
      return;
    }

    const allAsesorIds = [...new Set(orders.map((o: any) => String(o.asesorId?._id || o.asesorId)))].filter(Boolean);
    const asesores = await models.users
      .find({ _id: { $in: allAsesorIds } })
      .select('name email')
      .lean();

    const contactInfo = {
      clientName: orders[0].clientName,
      clientEmail: orders[0].clientEmail,
      clientPhone: orders[0].clientPhone,
      totalOrders: orders.length,
      firstOrderDate: orders[orders.length - 1].createdAt,
      lastOrderDate: orders[0].createdAt,
      asesores,
    };

    res.status(200).json({ contacto: contactInfo, orders });
  } catch (error) {
    next(error);
  }
}
