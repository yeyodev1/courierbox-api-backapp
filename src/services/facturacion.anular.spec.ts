import mongoose from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  facturasFindById: vi.fn(),
  facturasFindOneAndUpdate: vi.fn(),
  paquetesCount: vi.fn(),
  paquetesUpdateMany: vi.fn(),
}));

vi.mock("../models/index", () => ({
  models: {
    facturas: { findById: mocks.facturasFindById, findOneAndUpdate: mocks.facturasFindOneAndUpdate },
    paquetes: { countDocuments: mocks.paquetesCount, updateMany: mocks.paquetesUpdateMany },
  },
}));
vi.mock("./contifico.service", () => ({ contificoService: {} }));
vi.mock("./configuracion_facturacion.service", () => ({ IVA_PORCENTAJE_DEFECTO: 15, obtenerIvaPorcentaje: vi.fn() }));
vi.mock("./ghl-webhook.service", () => ({ enviarWebhookFactura: vi.fn() }));
vi.mock("./notification.service", () => ({ createAndSendNotification: vi.fn() }));
vi.mock("../config/env", () => ({ env: { FRONTEND_ORIGIN: [] } }));

import { anularFactura } from "./facturacion.service";

const id = new mongoose.Types.ObjectId();
const userId = new mongoose.Types.ObjectId().toString();

describe("anularFactura", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.paquetesCount.mockResolvedValue(0);
    mocks.paquetesUpdateMany.mockResolvedValue({ modifiedCount: 3 });
  });

  it("exige un motivo", async () => {
    const r = await anularFactura(id.toString(), "  ", userId);
    expect(r).toMatchObject({ exito: false, status: 400 });
    expect(mocks.facturasFindById).not.toHaveBeenCalled();
  });

  it("no anula una factura pagada", async () => {
    mocks.facturasFindById.mockResolvedValue({ _id: id, estado: "pagada" });
    const r = await anularFactura(id.toString(), "Error en el peso", userId);
    expect(r).toMatchObject({ exito: false, status: 409 });
    expect(mocks.facturasFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it("no anula si alguna caja ya se entregó", async () => {
    mocks.facturasFindById.mockResolvedValue({ _id: id, estado: "pendiente" });
    mocks.paquetesCount.mockResolvedValue(1);
    const r = await anularFactura(id.toString(), "Error en el peso", userId);
    expect(r).toMatchObject({ exito: false, status: 409 });
    expect(mocks.paquetesUpdateMany).not.toHaveBeenCalled();
  });

  it("anula y deja las cajas otra vez por facturar", async () => {
    mocks.facturasFindById.mockResolvedValue({ _id: id, estado: "verificando" });
    mocks.facturasFindOneAndUpdate.mockResolvedValue({ _id: id, estado: "anulada", numeroFactura: "001-001-000000123" });
    const r = await anularFactura(id.toString(), "Cliente equivocado", userId);
    expect(r).toMatchObject({ exito: true, paquetesLiberados: 3 });
    const [filtro, update] = mocks.facturasFindOneAndUpdate.mock.calls[0];
    expect(filtro.estado.$in).toEqual(["pendiente", "verificando"]);
    expect(update.$set).toMatchObject({ estado: "anulada", anuladaMotivo: "Cliente equivocado" });
    expect(mocks.paquetesUpdateMany).toHaveBeenCalledWith(
      { facturaId: id },
      { $set: { estado: "validado", facturaId: null } }
    );
  });

  it("si otro la anuló primero, no libera nada", async () => {
    mocks.facturasFindById.mockResolvedValue({ _id: id, estado: "pendiente" });
    mocks.facturasFindOneAndUpdate.mockResolvedValue(null);
    const r = await anularFactura(id.toString(), "Cliente equivocado", userId);
    expect(r).toMatchObject({ exito: false, status: 409 });
    expect(mocks.paquetesUpdateMany).not.toHaveBeenCalled();
  });
});
