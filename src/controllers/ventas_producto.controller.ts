import type { Request, Response, NextFunction } from "express";
import { Types } from "mongoose";
import { models } from "../models/index";
import { METODOS_ENTREGA, type ICuotaCredito } from "../models/venta_producto.model";
import { sendVentaProductoAdmin, sendVentaProductoCliente } from "../services/email.service";
import { postFinancialMovement } from "../services/financial-movement.service";
import {
  comisionTotalDe,
  eliminarAbonoVenta,
  estadoPagoFor,
  normalizeMetodo,
  registrarAbonoVenta,
  settleCuotas,
  syncComisionMovement,
  toMoney,
} from "../services/venta_producto.service";
import { endOfCalendarDate, toCalendarDate, todayAsCalendarDate } from "../utils/calendar-date";

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

/**
 * The sales list, and alongside it what the period is still owed.
 *
 * The totals come from the filtered set rather than from the page of rows sent
 * back: the list is capped at a couple of hundred records and a balance that
 * only counted the visible ones would quietly understate the debt the further
 * back Oscar looked.
 */
export async function listVentas(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const take = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const { estadoPago, desde, hasta, clienteId } = req.query;

    const filter: Record<string, any> = {};
    if (estadoPago === "pendiente" || estadoPago === "parcial" || estadoPago === "pagado") {
      filter.estadoPago = estadoPago;
    }
    // "Con saldo" is the working view: everything still owed, part-paid or not.
    if (estadoPago === "con_saldo") filter.estadoPago = { $in: ["pendiente", "parcial"] };
    if (clienteId && Types.ObjectId.isValid(String(clienteId))) filter.clienteId = clienteId;

    const desdeFecha = toCalendarDate(desde);
    const hastaFecha = endOfCalendarDate(hasta);
    if (desdeFecha || hastaFecha) {
      filter.fecha = {};
      if (desdeFecha) filter.fecha.$gte = desdeFecha;
      if (hastaFecha) filter.fecha.$lte = hastaFecha;
    }

    const [items, totales] = await Promise.all([
      models.ventasProducto.find(filter).sort({ fecha: -1 }).limit(take).lean(),
      models.ventasProducto.aggregate([
        { $match: filter },
        {
          $group: {
            _id: null,
            ventas: { $sum: 1 },
            total: { $sum: "$total" },
            cobrado: { $sum: "$valorPagado" },
            pendiente: { $sum: "$saldo" },
            conSaldo: { $sum: { $cond: [{ $gt: ["$saldo", 0] }, 1, 0] } },
          },
        },
      ]),
    ]);

    const agg = totales[0] || {};
    res.status(200).json({
      items,
      resumen: {
        ventas: Number(agg.ventas || 0),
        total: toMoney(agg.total),
        cobrado: toMoney(agg.cobrado),
        pendiente: toMoney(agg.pendiente),
        conSaldo: Number(agg.conSaldo || 0),
      },
    });
  } catch (error) {
    next(error);
  }
}

function normalizeCuotas(input: unknown): ICuotaCredito[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((c: Record<string, unknown>) => ({
      fecha: toCalendarDate(c.fecha) ?? todayAsCalendarDate(),
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
    const cuotas = esCredito ? normalizeCuotas(b.cuotas) : [];

    // What was actually collected at the till. A credit sale takes a deposit; a
    // cash sale takes the lot — but only if the money really came in, which is
    // what `pagoConfirmado` says. A sale handed over unpaid starts at zero and
    // shows up as owed instead of silently reading as settled.
    const pagoInicial = esCredito
      ? Math.min(Math.max(toMoney(b.abono), 0), total)
      : b.pagoConfirmado
        ? total
        : Math.min(Math.max(toMoney(b.valorPagado ?? b.abono), 0), total);
    const valorPagado = toMoney(pagoInicial);
    const saldo = toMoney(Math.max(total - valorPagado, 0));
    const estadoPago = estadoPagoFor(total, valorPagado);
    const fechaVenta = toCalendarDate(b.fecha) ?? todayAsCalendarDate();

    const abonoInicialId = new Types.ObjectId();
    const abonos = valorPagado > 0
      ? [
          {
            _id: abonoInicialId,
            monto: valorPagado,
            fecha: fechaVenta,
            metodo: normalizeMetodo(b.metodoPago),
            referencia: "",
            notas: "Pago registrado al crear la venta",
            registradoPor: user.userId,
            registradoPorNombre: b.vendedorNombre || user.email,
            createdAt: new Date(),
          },
        ]
      : [];

    const cliente = b.clienteId ? await models.masterClientes.findById(b.clienteId).lean() : null;
    const clienteNombre = b.clienteNombre || cliente?.nombreOficial || "";
    const clienteEmail = b.clienteEmail || cliente?.email || "";

    const venta = await models.ventasProducto.create({
      fecha: fechaVenta,
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
      pagoConfirmado: estadoPago === "pagado",
      subtotal,
      total,
      esCredito,
      abono: esCredito ? valorPagado : 0,
      valorPagado,
      saldo,
      estadoPago,
      abonos,
      pagoCompletadoEn: estadoPago === "pagado" ? new Date() : undefined,
      cuotas: settleCuotas(cuotas, total, valorPagado),
      observacion: b.observacion || "",
      creadoPor: user.userId,
      updatedBy: user.userId,
    });

    // Decrement stock best-effort (never blocks the sale).
    if (producto?._id) {
      await models.productosInventario.findByIdAndUpdate(producto._id, { $inc: { stock: -cantidad } }).catch(() => {});
    }

    // Product sales used to stop at their own screen: nothing reached the ledger,
    // so Estado de Resultados showed the expense of buying stock and none of the
    // income from selling it. Income posts as the money arrives, like every other
    // abono in the system; the commission posts once the sale is fully paid.
    let ledgerOk = true;
    if (valorPagado > 0) {
      try {
        await postFinancialMovement({
          direccion: "ingreso",
          base: "devengado",
          origen: "venta",
          origenId: String(venta._id),
          concepto: `abono:${String(abonoInicialId)}`,
          categoria: "VENTA_PRODUCTO",
          monto: valorPagado,
          estado: "confirmado",
          fechaOperacion: fechaVenta,
          fechaPago: fechaVenta,
          clienteId: venta.clienteId,
          asesorId: venta.vendedorId,
          creadoPor: user.userId,
          metadata: { ventaId: String(venta._id), abonoId: String(abonoInicialId), saldoPendiente: saldo },
        });
        await syncComisionMovement(venta as any, user.userId);
      } catch (ledgerError) {
        // The sale happened; refusing the request now would leave stock already
        // decremented and the operator with no record of it. The failure is
        // reported back instead of swallowed, so the entry can be replayed.
        ledgerOk = false;
        console.error("No se pudo registrar el movimiento contable de la venta", ledgerError);
      }
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
      abono: venta.valorPagado,
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

    res.status(201).json({
      item: venta,
      correos: { admin: adminRes.success, cliente: clienteRes.success },
      contabilidad: ledgerOk,
    });
  } catch (error) {
    next(error);
  }
}

/* ------------------------------------------------------------------ */
/* Editing a sale and its payments                                     */
/* ------------------------------------------------------------------ */

export async function getVenta(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const venta = await models.ventasProducto
      .findById(req.params.id)
      .populate("abonos.registradoPor", "name email")
      .lean();
    if (!venta) return void res.status(404).json({ error: "Venta not found" });
    res.status(200).json({ item: venta });
  } catch (error) {
    next(error);
  }
}

/**
 * Correct a sale after the fact.
 *
 * A sale was write-once, so a wrong price or a mistyped quantity could only be
 * lived with. Re-pricing moves the total, and the balance follows it — but never
 * below what has already been collected: money that came in is a fact, and a
 * total that contradicts it would be the sale owing the client. That case is
 * refused with the figure to fix, rather than clamped into a silent mismatch.
 */
export async function updateVenta(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = getUser(req);
    if (!user) return void res.status(401).json({ error: "Unauthorized" });

    const venta = await models.ventasProducto.findById(req.params.id).lean();
    if (!venta) return void res.status(404).json({ error: "Venta not found" });

    const b = req.body || {};
    const updates: Record<string, any> = {};

    if (b.fecha !== undefined) updates.fecha = toCalendarDate(b.fecha) ?? todayAsCalendarDate();
    if (b.vendedorNombre !== undefined) updates.vendedorNombre = String(b.vendedorNombre || "");
    if (b.vendedorId !== undefined) updates.vendedorId = b.vendedorId || undefined;
    if (b.clienteId !== undefined) updates.clienteId = b.clienteId || undefined;
    if (b.clienteNombre !== undefined) updates.clienteNombre = String(b.clienteNombre || "");
    if (b.clienteEmail !== undefined) updates.clienteEmail = String(b.clienteEmail || "");
    if (b.metodoPago !== undefined) updates.metodoPago = String(b.metodoPago || "");
    if (b.observacion !== undefined) updates.observacion = String(b.observacion || "");
    if (b.comisionUnitaria !== undefined) updates.comisionUnitaria = Math.max(toMoney(b.comisionUnitaria), 0);
    if (b.costoUnitario !== undefined) updates.costoUnitario = Math.max(toMoney(b.costoUnitario), 0);
    if (b.precioModo !== undefined) updates.precioModo = b.precioModo === "manual" ? "manual" : "automatico";
    if (b.metodoEntrega !== undefined && METODOS_ENTREGA.includes(b.metodoEntrega)) {
      updates.metodoEntrega = b.metodoEntrega;
    }
    if (b.cantidad !== undefined) updates.cantidad = Math.max(Number(b.cantidad) || 1, 1);
    if (b.precioUnitario !== undefined) updates.precioUnitario = Math.max(toMoney(b.precioUnitario), 0);
    if (b.valorEnvio !== undefined) updates.valorEnvio = Math.max(toMoney(b.valorEnvio), 0);
    if (b.esCredito !== undefined) updates.esCredito = Boolean(b.esCredito);
    if (b.cuotas !== undefined) updates.cuotas = normalizeCuotas(b.cuotas);

    const cantidad = updates.cantidad ?? venta.cantidad;
    const precioUnitario = updates.precioUnitario ?? venta.precioUnitario;
    const valorEnvio = updates.valorEnvio ?? venta.valorEnvio;
    const metodoEntrega = updates.metodoEntrega ?? venta.metodoEntrega;

    const subtotal = toMoney(precioUnitario * cantidad);
    const total = toMoney(subtotal + (metodoEntrega === "envio" ? valorEnvio : 0));
    const valorPagado = toMoney(venta.valorPagado);

    if (total < valorPagado) {
      return void res.status(400).json({
        error: `El total ($${total.toFixed(2)}) no puede quedar por debajo de lo ya cobrado ($${valorPagado.toFixed(2)}). Elimina o corrige los abonos primero.`,
      });
    }

    const estadoPago = estadoPagoFor(total, valorPagado);
    updates.subtotal = subtotal;
    updates.total = total;
    updates.saldo = toMoney(total - valorPagado);
    updates.estadoPago = estadoPago;
    updates.pagoConfirmado = estadoPago === "pagado";
    updates.cuotas = settleCuotas(updates.cuotas ?? venta.cuotas ?? [], total, valorPagado);
    updates.updatedBy = user.userId;

    const updated = await models.ventasProducto
      .findByIdAndUpdate(req.params.id, { $set: updates }, { new: true, runValidators: true })
      .lean();
    if (!updated) return void res.status(404).json({ error: "Venta not found" });

    // Re-pricing changes what the seller earned, so the commission movement is
    // reconciled against the new figure rather than left on the old one.
    await syncComisionMovement(updated as any, user.userId);

    res.status(200).json({ item: updated });
  } catch (error) {
    next(error);
  }
}

export async function registrarAbono(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = getUser(req);
    if (!user) return void res.status(401).json({ error: "Unauthorized" });

    const venta = await registrarAbonoVenta(
      String(req.params.id),
      {
        monto: Number(req.body?.monto),
        fecha: req.body?.fecha,
        metodo: req.body?.metodo,
        referencia: req.body?.referencia,
        notas: req.body?.notas,
      },
      user.userId,
      user.email
    );
    if (!venta) return void res.status(404).json({ error: "Venta not found" });
    res.status(200).json({ item: venta });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo registrar el abono";
    res.status(400).json({ error: message });
  }
}

export async function eliminarAbono(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = getUser(req);
    if (!user) return void res.status(401).json({ error: "Unauthorized" });

    const venta = await eliminarAbonoVenta(String(req.params.id), String(req.params.abonoId), user.userId);
    if (!venta) return void res.status(404).json({ error: "Venta not found" });
    res.status(200).json({ item: venta });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo eliminar el abono";
    res.status(400).json({ error: message });
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

/**
 * Casillero is the unique key of a master client, but the sale form does not
 * always know it. Generate a collision-free placeholder so the operator can
 * register the client on the spot and correct the code later.
 */
async function generarCasillero(): Promise<string> {
  for (let i = 0; i < 12; i++) {
    const code = `CBX${Math.floor(100000 + Math.random() * 900000)}`;
    const taken = await models.masterClientes.exists({ codigoCasillero: code });
    if (!taken) return code;
  }
  return `CBX${Date.now().toString(36).toUpperCase()}`;
}

/** Create a master client straight from the sale form when the search finds none. */
export async function crearClienteVenta(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = getUser(req);
    if (!user) return void res.status(401).json({ error: "Unauthorized" });

    const nombreOficial = String(req.body.nombreOficial ?? "").trim();
    if (!nombreOficial) return void res.status(400).json({ error: "El nombre del cliente es obligatorio" });

    const cedulaRuc = String(req.body.cedulaRuc ?? "").trim();
    const email = String(req.body.email ?? "").trim();
    const telefono = String(req.body.telefono ?? "").trim();
    const casilleroInput = String(req.body.codigoCasillero ?? "").trim().toUpperCase();

    if (casilleroInput) {
      const existente = await models.masterClientes.findOne({ codigoCasillero: casilleroInput }).lean();
      if (existente) {
        return void res.status(409).json({
          error: `El casillero ${casilleroInput} ya pertenece a ${(existente as any).nombreOficial}`,
          cliente: existente,
        });
      }
    }

    // Same "validación estricta" as the homologation flow: one cédula/RUC must
    // not spawn a second account.
    if (cedulaRuc) {
      const porCedula = await models.masterClientes.findOne({ cedulaRuc }).lean();
      if (porCedula) {
        return void res.status(409).json({
          error: `Esa cédula/RUC ya pertenece a ${(porCedula as any).nombreOficial} (${(porCedula as any).codigoCasillero}). Usa ese cliente.`,
          cliente: porCedula,
        });
      }
    }

    const codigoCasillero = casilleroInput || (await generarCasillero());
    const creado = await models.masterClientes.create({
      codigoCasillero,
      nombreOficial,
      cedulaRuc,
      email,
      telefono,
      notas: "Creado desde Ventas de productos",
    });

    res.status(201).json({
      cliente: {
        _id: String(creado._id),
        nombreOficial: creado.nombreOficial,
        codigoCasillero: creado.codigoCasillero,
        cedulaRuc: creado.cedulaRuc,
        email: creado.email,
        telefono: creado.telefono,
      },
    });
  } catch (error) {
    next(error);
  }
}
