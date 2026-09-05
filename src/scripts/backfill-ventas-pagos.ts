import "dotenv/config";
import { Types } from "mongoose";
import { dbConnect } from "../db/mongo";
import { models } from "../models/index";
import { estadoPagoFor, normalizeMetodo, settleCuotas, toMoney } from "../services/venta_producto.service";

/**
 * Bring sales filed before the paid/owed split onto the same footing.
 *
 * Those records carry the old shape: `abono` holds the deposit on a credit sale,
 * `pagoConfirmado` says whether a cash sale was settled, and `saldo` is zero on
 * everything that was not sold on credit — including sales handed over unpaid,
 * which is precisely the debt Oscar could not see. This reads the intent out of
 * the old fields and writes it into `valorPagado` / `saldo` / `estadoPago`, with
 * the money already collected recorded as the sale's first abono.
 *
 * Runs as a dry run by default and prints what it would change. Pass `--apply`
 * to write. Ledger movements are left alone unless `--con-movimientos` is given:
 * posting income for historical sales rewrites past months of Estado de
 * Resultados, and that is a decision, not a migration detail.
 */

const APPLY = process.argv.includes("--apply");
const WITH_MOVEMENTS = process.argv.includes("--con-movimientos");

async function main() {
  await dbConnect();

  const ventas = await models.ventasProducto.find({}).lean();
  let migradas = 0;
  let pendienteDescubierto = 0;

  for (const venta of ventas) {
    const yaMigrada = Array.isArray(venta.abonos) && venta.abonos.length > 0;
    if (yaMigrada && venta.estadoPago) continue;

    const total = toMoney(venta.total);
    const esCredito = Boolean(venta.esCredito);
    const valorPagado = toMoney(
      Math.min(esCredito ? toMoney(venta.abono) : venta.pagoConfirmado ? total : 0, total)
    );
    const saldo = toMoney(Math.max(total - valorPagado, 0));
    const estadoPago = estadoPagoFor(total, valorPagado);

    // Only the sales that were reporting zero owed while money was still out.
    if (saldo > 0 && toMoney(venta.saldo) === 0) pendienteDescubierto += saldo;

    const abonoId = new Types.ObjectId();
    const set: Record<string, unknown> = {
      valorPagado,
      saldo,
      estadoPago,
      pagoConfirmado: estadoPago === "pagado",
      cuotas: settleCuotas(venta.cuotas || [], total, valorPagado),
      abonos:
        valorPagado > 0
          ? [
              {
                _id: abonoId,
                monto: valorPagado,
                fecha: venta.fecha ?? venta.createdAt ?? new Date(),
                metodo: normalizeMetodo(venta.metodoPago),
                referencia: "",
                notas: "Pago registrado antes del histórico de abonos",
                registradoPor: venta.creadoPor,
                registradoPorNombre: venta.vendedorNombre || "",
                createdAt: venta.createdAt ?? new Date(),
              },
            ]
          : [],
    };
    if (estadoPago === "pagado") set.pagoCompletadoEn = venta.updatedAt ?? venta.createdAt ?? new Date();

    migradas += 1;

    if (!APPLY) {
      console.log(
        `[dry-run] ${String(venta._id)} ${venta.clienteNombre || "(sin cliente)"} — total $${total.toFixed(2)}, pagado $${valorPagado.toFixed(2)}, saldo $${saldo.toFixed(2)} → ${estadoPago}`
      );
      continue;
    }

    await models.ventasProducto.updateOne({ _id: venta._id }, { $set: set });

    if (WITH_MOVEMENTS && valorPagado > 0) {
      const { postFinancialMovement } = await import("../services/financial-movement.service");
      await postFinancialMovement({
        direccion: "ingreso",
        base: "devengado",
        origen: "venta",
        origenId: String(venta._id),
        concepto: `abono:${String(abonoId)}`,
        categoria: "VENTA_PRODUCTO",
        monto: valorPagado,
        estado: "confirmado",
        fechaOperacion: venta.fecha ?? venta.createdAt ?? new Date(),
        fechaPago: venta.fecha ?? venta.createdAt ?? new Date(),
        clienteId: venta.clienteId,
        asesorId: venta.vendedorId,
        creadoPor: venta.creadoPor,
        metadata: { ventaId: String(venta._id), abonoId: String(abonoId), backfill: true },
      });
    }
  }

  console.log(
    `${APPLY ? "Migradas" : "Se migrarían"} ${migradas} de ${ventas.length} ventas. ` +
      `Saldo pendiente que estaba oculto: $${pendienteDescubierto.toFixed(2)}. ` +
      `Movimientos contables: ${WITH_MOVEMENTS ? "sí" : "no (pasa --con-movimientos)"}.`
  );
  if (!APPLY) console.log("Dry run: no se escribió nada. Pasa --apply para aplicar.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Backfill de pagos de ventas falló:", error);
    process.exit(1);
  });
