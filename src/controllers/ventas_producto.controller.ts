import type { Request, Response, NextFunction } from "express";
import { models } from "../models/index";
import { METODOS_ENTREGA, type ICuotaCredito } from "../models/venta_producto.model";
import { sendVentaProductoAdmin, sendVentaProductoCliente } from "../services/email.service";

function getUser(req: Request) {
  return req.user as { userId: string; email: string; role: string } | undefined;
}

/* ------------------------------------------------------------------ */
/* Inventory                                                          */
/* ------------------------------------------------------------------ */

export async function listInventario(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const soloActivos = req.query.activos !== "false";
    const query: Record<string, unknown> = soloActivos ? { activo: true } : {};
    const items = await models.productosInventario.find(query).sort({ nombre: 1 }).lean();
    res.status(200).json({ items });
  } catch (error) {
    next(error);
  }
}

export async function createInventario(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = getUser(req);
    if (!user) return void res.status(401).json({ error: "Unauthorized" });
    const { nombre, precio, precioMayorista, costo, comision, stock, notas } = req.body;
    if (!nombre || !String(nombre).trim()) return void res.status(400).json({ error: "El nombre es obligatorio" });

    const item = await models.productosInventario.create({
      nombre: String(nombre).trim(),
      precio: Math.max(Number(precio) || 0, 0),
      precioMayorista: Math.max(Number(precioMayorista) || 0, 0),
      costo: Math.max(Number(costo) || 0, 0),
      comision: Math.max(Number(comision) || 0, 0),
      stock: Number(stock) || 0,
      notas: notas || "",
      creadoPor: user.userId,
    });
    res.status(201).json({ item });
  } catch (error) {
    next(error);
  }
}

export async function updateInventario(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const patch: Record<string, unknown> = {};
    for (const key of ["nombre", "precio", "precioMayorista", "costo", "comision", "stock", "activo", "notas"]) {
      if (req.body[key] !== undefined) patch[key] = req.body[key];
    }
    const item = await models.productosInventario.findByIdAndUpdate(req.params.id, patch, { new: true }).lean();
    if (!item) return void res.status(404).json({ error: "Producto no encontrado" });
    res.status(200).json({ item });
  } catch (error) {
    next(error);
  }
}

/* ------------------------------------------------------------------ */
/* Sales                                                              */
/* ------------------------------------------------------------------ */

export async function listVentas(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const take = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const items = await models.ventasProducto.find().sort({ fecha: -1 }).limit(take).lean();
    res.status(200).json({ items });
  } catch (error) {
    next(error);
  }
}

function normalizeCuotas(input: unknown): ICuotaCredito[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((c: Record<string, unknown>) => ({
      fecha: c.fecha ? new Date(c.fecha as string) : new Date(),
      monto: Math.max(Number(c.monto) || 0, 0),
      pagada: Boolean(c.pagada),
      recordatorioEnviado: false,
    }))
    .filter((c) => !Number.isNaN(c.fecha.getTime()));
}

export async function createVenta(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = getUser(req);
    if (!user) return void res.status(401).json({ error: "Unauthorized" });
    const b = req.body;

    const cantidad = Math.max(Number(b.cantidad) || 1, 1);
    const producto = b.productoId ? await models.productosInventario.findById(b.productoId).lean() : null;

    // Price is automatic (from inventory) unless the seller overrode it.
    const precioModo = b.precioModo === "manual" ? "manual" : "automatico";
    const precioUnitario =
      precioModo === "manual"
        ? Math.max(Number(b.precioUnitario) || 0, 0)
        : Math.max(Number(producto?.precio) || Number(b.precioUnitario) || 0, 0);
    const costoUnitario = Math.max(Number(producto?.costo) || Number(b.costoUnitario) || 0, 0);
    const comisionUnitaria = Math.max(Number(producto?.comision) || Number(b.comisionUnitaria) || 0, 0);

    const valorEnvio = Math.max(Number(b.valorEnvio) || 0, 0);
    const metodoEntrega = METODOS_ENTREGA.includes(b.metodoEntrega) ? b.metodoEntrega : "retiro_oficina";
    const subtotal = precioUnitario * cantidad;
    const total = subtotal + (metodoEntrega === "envio" ? valorEnvio : 0);

    const esCredito = Boolean(b.esCredito);
    const abono = esCredito ? Math.min(Math.max(Number(b.abono) || 0, 0), total) : 0;
    const saldo = esCredito ? Math.max(total - abono, 0) : 0;
    const cuotas = esCredito ? normalizeCuotas(b.cuotas) : [];

    const cliente = b.clienteId ? await models.masterClientes.findById(b.clienteId).lean() : null;
    const clienteNombre = b.clienteNombre || cliente?.nombreOficial || "";
    const clienteEmail = b.clienteEmail || cliente?.email || "";

    const venta = await models.ventasProducto.create({
      fecha: b.fecha ? new Date(b.fecha) : new Date(),
      vendedorNombre: b.vendedorNombre || user.email,
      vendedorId: b.vendedorId || undefined,
      clienteId: b.clienteId || undefined,
      clienteNombre,
      clienteEmail,
      productoId: b.productoId || undefined,
      productoNombre: producto?.nombre || b.productoNombre || "",
      cantidad,
      precioModo,
      precioUnitario,
      costoUnitario,
      comisionUnitaria,
      metodoEntrega,
      valorEnvio,
      metodoPago: b.metodoPago || "",
      pagoConfirmado: Boolean(b.pagoConfirmado),
      subtotal,
      total,
      esCredito,
      abono,
      saldo,
      cuotas,
      observacion: b.observacion || "",
      creadoPor: user.userId,
    });

    // Decrement stock best-effort (never blocks the sale).
    if (producto?._id) {
      await models.productosInventario.findByIdAndUpdate(producto._id, { $inc: { stock: -cantidad } }).catch(() => {});
    }

    // Fire the two emails. Failures are recorded but never fail the request.
    const emailData = {
      vendedorNombre: venta.vendedorNombre,
      clienteNombre: venta.clienteNombre,
      productoNombre: venta.productoNombre,
      cantidad: venta.cantidad,
      precioUnitario: venta.precioUnitario,
      subtotal: venta.subtotal,
      valorEnvio: venta.valorEnvio,
      total: venta.total,
      metodoEntrega: venta.metodoEntrega,
      metodoPago: venta.metodoPago,
      pagoConfirmado: venta.pagoConfirmado,
      esCredito: venta.esCredito,
      abono: venta.abono,
      saldo: venta.saldo,
      cuotas: venta.cuotas.map((c) => ({ fecha: c.fecha, monto: c.monto })),
      observacion: venta.observacion,
      costoTotal: venta.costoUnitario * venta.cantidad,
      comisionTotal: venta.comisionUnitaria * venta.cantidad,
    };
    const adminRes = await sendVentaProductoAdmin(emailData);
    const clienteRes = venta.clienteEmail
      ? await sendVentaProductoCliente(venta.clienteEmail, emailData)
      : { success: false };
    venta.correoAdminEnviado = adminRes.success;
    venta.correoClienteEnviado = clienteRes.success;
    await venta.save();

    res.status(201).json({ item: venta, correos: { admin: adminRes.success, cliente: clienteRes.success } });
  } catch (error) {
    next(error);
  }
}

/* ------------------------------------------------------------------ */
/* Credit collection reminders                                        */
/* ------------------------------------------------------------------ */

/**
 * Upcoming and overdue installments across every credit sale, so the panel can
 * surface who to charge and when. Full email-on-date reminders would need a
 * scheduled job (there is no cron here yet); this is the in-app equivalent.
 */
export async function recordatoriosCobro(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const dias = Math.min(Math.max(parseInt(req.query.dias as string) || 30, 1), 180);
    const hasta = new Date();
    hasta.setDate(hasta.getDate() + dias);

    const ventas = await models.ventasProducto
      .find({ esCredito: true, "cuotas.pagada": false, "cuotas.fecha": { $lte: hasta } })
      .sort({ "cuotas.fecha": 1 })
      .lean();

    const ahora = new Date();
    const items = ventas.flatMap((v) =>
      (v.cuotas || [])
        .map((c, idx) => ({ ...c, idx }))
        .filter((c) => !c.pagada && new Date(c.fecha) <= hasta)
        .map((c) => ({
          ventaId: v._id,
          cuotaIndex: c.idx,
          clienteNombre: v.clienteNombre,
          clienteEmail: v.clienteEmail,
          productoNombre: v.productoNombre,
          fecha: c.fecha,
          monto: c.monto,
          vencida: new Date(c.fecha) < ahora,
        }))
    );

    res.status(200).json({ items });
  } catch (error) {
    next(error);
  }
}

/** Lightweight client lookup for the sale form (name / casillero / cédula). */
export async function buscarClientesVenta(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const q = String(req.query.q ?? "").trim();
    if (q.length < 2) return void res.status(200).json({ clientes: [] });
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const clientes = await models.masterClientes
      .find({ $or: [{ nombreOficial: rx }, { codigoCasillero: rx }, { cedulaRuc: rx }, { email: rx }] })
      .select("nombreOficial codigoCasillero cedulaRuc email telefono")
      .limit(20)
      .lean();
    res.status(200).json({ clientes });
  } catch (error) {
    next(error);
  }
}
