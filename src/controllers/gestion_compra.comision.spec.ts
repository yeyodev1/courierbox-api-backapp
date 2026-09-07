import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  calcularComisionPreview: vi.fn(),
  createGestionCompra: vi.fn(),
}));

vi.mock("../services/gestion_compra.service.js", () => ({
  calcularComisionPreview: mocks.calcularComisionPreview,
  createGestionCompra: mocks.createGestionCompra,
}));

vi.mock("../services/upload.service.js", () => ({ uploadGestionCompraImagen: vi.fn() }));
vi.mock("../services/pdf.service.js", () => ({ htmlToPdf: vi.fn() }));
vi.mock("../models/index.js", () => ({
  models: { users: { findById: mocks.findById, findOne: vi.fn() } },
}));

import { createGestion } from "./gestion_compra.controller";

function makeRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() };
}

function makeReq(role: string, body: Record<string, unknown>) {
  return { user: { userId: "u1", email: "quien@sea.com", role }, body } as any;
}

const cuerpoBase = { valorTotal: 100, valorReserva: 0, contactoId: "c1" };

describe("createGestion — la comisión que se guarda", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findById.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue({ _id: "u1", name: "Asesor Uno", email: "quien@sea.com" }),
    });
    mocks.createGestionCompra.mockResolvedValue({ _id: "g1" });
  });

  const comisionGuardada = () => mocks.createGestionCompra.mock.calls[0][0].valorComision;

  it("aplica la regla cuando existe, aunque el asesor escriba otra cosa", async () => {
    mocks.calcularComisionPreview.mockResolvedValue({ valorComision: 15, feeConfigNombre: "Regla", calculada: true });

    await createGestion(makeReq("asesor", { ...cuerpoBase, valorComision: 99 }), makeRes() as any, vi.fn());

    expect(comisionGuardada()).toBe(15);
  });

  /**
   * El reporte del cliente. Sin regla configurada el preview devuelve 0 y ese 0
   * pisaba la comisión escrita en el wizard: la gestión quedaba en cero.
   */
  it("guarda lo que escribió el asesor cuando no hay regla configurada", async () => {
    mocks.calcularComisionPreview.mockResolvedValue({ valorComision: 0, feeConfigNombre: "Sin configurar", calculada: false });

    await createGestion(makeReq("asesor", { ...cuerpoBase, valorComision: 12.5 }), makeRes() as any, vi.fn());

    expect(comisionGuardada()).toBe(12.5);
  });

  it("rechaza en vez de guardar cero cuando no hay regla ni valor escrito", async () => {
    mocks.calcularComisionPreview.mockResolvedValue({ valorComision: 0, feeConfigNombre: "Sin configurar", calculada: false });
    const res = makeRes();

    await createGestion(makeReq("asesor", cuerpoBase), res as any, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mocks.createGestionCompra).not.toHaveBeenCalled();
  });

  it("rechaza cuando un admin no manda la comisión", async () => {
    const res = makeRes();

    await createGestion(makeReq("admin", cuerpoBase), res as any, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mocks.createGestionCompra).not.toHaveBeenCalled();
  });

  it("un cero que el admin escribe a propósito sí se guarda", async () => {
    await createGestion(makeReq("admin", { ...cuerpoBase, valorComision: 0 }), makeRes() as any, vi.fn());

    expect(comisionGuardada()).toBe(0);
    expect(mocks.calcularComisionPreview).not.toHaveBeenCalled();
  });

  it("rechaza una comisión negativa", async () => {
    const res = makeRes();

    await createGestion(makeReq("admin", { ...cuerpoBase, valorComision: -5 }), res as any, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mocks.createGestionCompra).not.toHaveBeenCalled();
  });
});
