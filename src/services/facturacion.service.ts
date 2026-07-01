import { models } from "../models/index";
import { contificoService } from "./contifico.service";
import { enviarWebhookFactura } from "./ghl-webhook.service";
import { logger } from "../utils/logger";

const TARIFA_FLETE_LB = 6.50;
const TARIFA_ARANCEL_LB = 1.99;
const IVA = 0.15;

export async function facturarPaquetes(paqueteIds: string[]): Promise<{
  exito: boolean;
  facturaId?: string;
  error?: string;
}> {
  const paquetes = await models.paquetes.find({ _id: { $in: paqueteIds } }).lean();
  if (!paquetes.length) {
    return { exito: false, error: "No se encontraron paquetes" };
  }

  const masterId = paquetes[0].masterClienteId;
  for (const p of paquetes) {
    if (p.masterClienteId?.toString() !== masterId?.toString()) {
      return { exito: false, error: "Todos los paquetes deben pertenecer al mismo cliente" };
    }
  }

  const cliente = masterId
    ? await models.masterClientes.findById(masterId).lean()
    : null;

  if (!cliente) {
    return { exito: false, error: "Cliente no encontrado" };
  }

  const pesoTotal = paquetes.reduce((sum, p) => sum + (p.pesoLb || 0), 0);
  const totalFlete = parseFloat((pesoTotal * TARIFA_FLETE_LB).toFixed(2));
  const totalArancel = parseFloat((pesoTotal * TARIFA_ARANCEL_LB).toFixed(2));
  const subtotal = totalFlete + totalArancel;
  const totalIva = parseFloat((subtotal * IVA).toFixed(2));
  const totalGeneral = parseFloat((subtotal + totalIva).toFixed(2));

  const contificoResult = await contificoService.emitirContifico({
    clienteId: cliente._id.toString(),
    clienteNombre: cliente.nombreOficial,
    clienteIdentificacion: cliente.cedulaRuc || "9999999999999",
    clienteEmail: cliente.email,
    clienteTelefono: cliente.telefono,
    items: [
      {
        descripcion: `Flete courier (${pesoTotal.toFixed(2)} lb)`,
        cantidad: 1,
        precioUnitario: totalFlete,
        porcentajeIva: 15,
      },
      {
        descripcion: `Arancel 4x4 (${pesoTotal.toFixed(2)} lb)`,
        cantidad: 1,
        precioUnitario: totalArancel,
        porcentajeIva: 0,
      },
    ],
    totalSinIva: subtotal,
    totalConIva: totalGeneral,
  });

  const factura = await models.facturas.create({
    numeroFactura: contificoResult.numeroFactura || `TEMP-${Date.now()}`,
    masterClienteId: cliente._id,
    paquetes: paqueteIds,
    pesoTotalLb: pesoTotal,
    totalFlete,
    totalArancel,
    totalGeneral,
    iva: totalIva,
    pdfUrl: contificoResult.pdfUrl || "",
    contificoResponse: contificoResult.respuestaRaw || {},
    estado: "pendiente",
  });

  await models.paquetes.updateMany(
    { _id: { $in: paqueteIds } },
    { $set: { estado: "facturado", facturaId: factura._id } }
  );

  if (contificoResult.exito) {
    enviarWebhookFactura({
      facturaId: factura._id.toString(),
      numeroFactura: factura.numeroFactura,
      totalAmount: factura.totalGeneral,
      pdfUrl: factura.pdfUrl,
      clienteNombre: cliente.nombreOficial,
      clienteTelefono: cliente.telefono,
      clienteEmail: cliente.email,
      codigoCasillero: cliente.codigoCasillero,
    }).catch((err) => logger.error("[facturacion] webhook error:", err));
  }

  return { exito: true, facturaId: factura._id.toString() };
}
