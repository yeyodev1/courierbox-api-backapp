import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { Types } from "mongoose";
import { dbConnect } from "../db/mongo";
import { models } from "../models/index";
import {
  CAMPOS_PAGO_MIGRABLES,
  normalizeMetodo,
  planPagoMigrado,
  settleCuotas,
  updateDesdeRespaldo,
} from "../services/venta_producto.service";

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
const RESTORE_FLAG = process.argv.indexOf("--restore");
const RESTORE_FILE = RESTORE_FLAG >= 0 ? process.argv[RESTORE_FLAG + 1] : undefined;

/**
 * Undoing this migration has to be possible without a database dump, because
 * the person running it may not have one and the alternative is reconstructing
 * payment state by hand. Every applied run writes the prior values of exactly
 * the fields it is about to overwrite, and `--restore` puts them back.
 */
function backupPath(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(process.cwd(), "backups", `ventas-pagos-${stamp}.json`);
}

async function restoreFromBackup(file: string) {
  const contenido = JSON.parse(await fs.readFile(file, "utf8")) as {
    generadoEn?: string;
    ventas: Array<{ _id: string } & Record<string, unknown>>;
  };
  const filas = contenido.ventas || [];

  for (const fila of filas) {
    const { _id, ...campos } = fila;
    await models.ventasProducto.updateOne({ _id }, updateDesdeRespaldo(campos));
  }

  console.log(
    `Restauradas ${filas.length} ventas desde ${file}` +
      (contenido.generadoEn ? ` (respaldo del ${contenido.generadoEn})` : "")
  );
}

async function main() {
  await dbConnect();

  if (RESTORE_FILE) {
    await restoreFromBackup(RESTORE_FILE);
    return;
  }

  const ventas = await models.ventasProducto.find({}).lean();
  let migradas = 0;
  let pendienteDescubierto = 0;
  const respaldo: Array<Record<string, unknown>> = [];
  const backupFile = backupPath();
  let backupWritten = false;

  for (const venta of ventas) {
    const yaMigrada = Array.isArray(venta.abonos) && venta.abonos.length > 0;
    if (yaMigrada && venta.estadoPago) continue;

    const { total, valorPagado, saldo, estadoPago, deudaOculta } = planPagoMigrado(venta);
    pendienteDescubierto += deudaOculta;

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

    // Captured for every candidate, dry run included, so the printed plan and
    // the backup describe the same set of documents.
    const previo: Record<string, unknown> = { _id: String(venta._id) };
    for (const campo of CAMPOS_PAGO_MIGRABLES) {
      const valor = (venta as unknown as Record<string, unknown>)[campo];
      if (valor !== undefined) previo[campo] = valor;
    }
    respaldo.push(previo);

    if (!APPLY) {
      console.log(
        `[dry-run] ${String(venta._id)} ${venta.clienteNombre || "(sin cliente)"} — total $${total.toFixed(2)}, pagado $${valorPagado.toFixed(2)}, saldo $${saldo.toFixed(2)} → ${estadoPago}`
      );
      continue;
    }

    if (!backupWritten) {
      await fs.mkdir(path.dirname(backupFile), { recursive: true });
      await fs.writeFile(
        backupFile,
        JSON.stringify({ generadoEn: new Date().toISOString(), ventas: respaldo }, null, 2)
      );
      backupWritten = true;
      console.log(`Respaldo escrito en ${backupFile}`);
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

  if (APPLY && backupWritten) {
    // Rewritten complete: the first write only held the documents seen so far.
    await fs.writeFile(
      backupFile,
      JSON.stringify({ generadoEn: new Date().toISOString(), ventas: respaldo }, null, 2)
    );
    console.log(`Respaldo final (${respaldo.length} ventas): ${backupFile}`);
    console.log(`Para revertir: pnpm ventas:backfill-pagos -- --restore ${backupFile}`);
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
