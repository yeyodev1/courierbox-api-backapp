import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  findOneAndUpdate: vi.fn(),
  postFinancialMovement: vi.fn(),
  createAndSendNotification: vi.fn(),
}));

vi.mock("../models/index.js", () => ({
  models: {
    gestionesCompra: {
      findById: mocks.findById,
      findOneAndUpdate: mocks.findOneAndUpdate,
    },
  },
}));

vi.mock("../services/financial-movement.service.js", () => ({
  postFinancialMovement: mocks.postFinancialMovement,
}));

vi.mock("./financial-movement.service.js", () => ({
  postFinancialMovement: mocks.postFinancialMovement,
}));

vi.mock("./notification.service.js", () => ({
  createAndSendNotification: mocks.createAndSendNotification,
}));

vi.mock("./fee.service.js", () => ({ calculateFee: vi.fn() }));

vi.mock("../config/env.js", () => ({ env: { FRONTEND_ORIGIN: ["https://courierboxlogistics.com"] } }));

vi.mock("../middleware/auth.middleware.js", () => ({ getCurrentAuthUser: vi.fn() }));

import { confirmarPago, registrarAbono } from "./gestion_compra.service";

/** `findById(...).lean()` and `findById(...).select(...).lean()` both appear. */
function mockGestion(gestion: Record<string, unknown> | null) {
  const lean = vi.fn().mockResolvedValue(gestion);
  mocks.findById.mockReturnValue({ lean, select: vi.fn().mockReturnValue({ lean }) });
}

function mockUpdateResult(gestion: Record<string, unknown> | null) {
  const populate = vi.fn().mockReturnThis();
  mocks.findOneAndUpdate.mockReturnValue({
    populate,
    lean: vi.fn().mockResolvedValue(gestion),
  });
}

const BASE = {
  _id: "g1",
  valorTotal: 500,
  valorPagado: 0,
  valorComision: 50,
  estado: "activa",
  viewToken: "tok",
  contactoId: { _id: "c1", nombre: "Ana", email: "ana@example.com" },
  asesorId: { _id: "a1", name: "Luis" },
};

describe("registrarAbono", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.postFinancialMovement.mockResolvedValue({});
    mocks.createAndSendNotification.mockResolvedValue(undefined);
  });

  it("deja la gestión en parcial mientras quede saldo", async () => {
    mockGestion({ ...BASE });
    mockUpdateResult({ ...BASE, valorPagado: 200, estadoPago: "parcial" });

    await registrarAbono("g1", { monto: 200 }, "u1", "Oscar");

    const [, update] = mocks.findOneAndUpdate.mock.calls[0];
    expect(update.$set.valorPagado).toBe(200);
    expect(update.$set.estadoPago).toBe("parcial");
    expect(update.$set.pagoConfirmadoEn).toBeUndefined();
  });

  it("acepta un segundo abono, que es lo que antes no tenía dónde ir", async () => {
    mockGestion({ ...BASE, valorPagado: 200, estadoPago: "parcial" });
    mockUpdateResult({ ...BASE, valorPagado: 500, estadoPago: "confirmado", pagoConfirmadoEn: new Date() });

    await registrarAbono("g1", { monto: 300 }, "u1", "Oscar");

    const [, update] = mocks.findOneAndUpdate.mock.calls[0];
    expect(update.$set.valorPagado).toBe(500);
    expect(update.$set.estadoPago).toBe("confirmado");
    expect(update.$set.pagoConfirmadoEn).toBeInstanceOf(Date);
  });

  it("suma en vez de reemplazar: el abono anterior no se pierde", async () => {
    mockGestion({ ...BASE, valorPagado: 120 });
    mockUpdateResult({ ...BASE, valorPagado: 170 });

    await registrarAbono("g1", { monto: 50 }, "u1", "Oscar");

    expect(mocks.findOneAndUpdate.mock.calls[0][1].$set.valorPagado).toBe(170);
  });

  it("rechaza un abono mayor al saldo pendiente", async () => {
    mockGestion({ ...BASE, valorPagado: 400 });

    await expect(registrarAbono("g1", { monto: 200 }, "u1", "Oscar")).rejects.toThrow(/saldo pendiente de \$100\.00/);
    expect(mocks.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("rechaza abonos sobre una gestión ya saldada", async () => {
    mockGestion({ ...BASE, valorPagado: 500 });

    await expect(registrarAbono("g1", { monto: 10 }, "u1", "Oscar")).rejects.toThrow(/ya está pagada/);
  });

  it("rechaza un monto en cero o negativo", async () => {
    mockGestion({ ...BASE });
    await expect(registrarAbono("g1", { monto: 0 }, "u1", "Oscar")).rejects.toThrow(/mayor a cero/);
    await expect(registrarAbono("g1", { monto: -30 }, "u1", "Oscar")).rejects.toThrow(/mayor a cero/);
  });

  it("rechaza abonos sobre una gestión cancelada", async () => {
    mockGestion({ ...BASE, estado: "cancelado" });
    await expect(registrarAbono("g1", { monto: 100 }, "u1", "Oscar")).rejects.toThrow(/cancelada/);
  });

  it("no registra dos veces si el saldo cambió mientras tanto", async () => {
    mockGestion({ ...BASE });
    mockUpdateResult(null);

    await expect(registrarAbono("g1", { monto: 100 }, "u1", "Oscar")).rejects.toThrow(/vuelve a intentarlo/);
    // The guard is the balance we read, so a concurrent abono makes this a no-op.
    expect(mocks.findOneAndUpdate.mock.calls[0][0]).toEqual({ _id: "g1", valorPagado: 0 });
  });

  it("postea un ingreso propio por abono, con concepto único", async () => {
    mockGestion({ ...BASE });
    mockUpdateResult({ ...BASE, valorPagado: 200, estadoPago: "parcial" });

    await registrarAbono("g1", { monto: 200 }, "u1", "Oscar");

    const ingreso = mocks.postFinancialMovement.mock.calls[0][0];
    expect(ingreso).toMatchObject({ direccion: "ingreso", monto: 200, origen: "gestion" });
    expect(ingreso.concepto).toMatch(/^abono:[a-f0-9]{24}$/);
  });

  it("fecha el ingreso cuando entró la plata, no cuando se cierra la venta", async () => {
    mockGestion({ ...BASE });
    mockUpdateResult({ ...BASE, valorPagado: 200 });

    await registrarAbono("g1", { monto: 200, fecha: "2026-08-14" }, "u1", "Oscar");

    const ingreso = mocks.postFinancialMovement.mock.calls[0][0];
    expect(ingreso.fechaPago.toISOString()).toBe("2026-08-14T00:00:00.000Z");
  });

  it("no cobra la comisión en cada cuota, solo al saldar", async () => {
    mockGestion({ ...BASE });
    mockUpdateResult({ ...BASE, valorPagado: 200, estadoPago: "parcial" });

    await registrarAbono("g1", { monto: 200 }, "u1", "Oscar");

    const conceptos = mocks.postFinancialMovement.mock.calls.map((c) => c[0].concepto);
    expect(conceptos).not.toContain("comision_asesor");
  });

  it("cobra la comisión una vez, cuando la gestión queda saldada", async () => {
    mockGestion({ ...BASE, valorPagado: 400 });
    mockUpdateResult({ ...BASE, valorPagado: 500, estadoPago: "confirmado", pagoConfirmadoEn: new Date() });

    await registrarAbono("g1", { monto: 100 }, "u1", "Oscar");

    const comision = mocks.postFinancialMovement.mock.calls.find((c) => c[0].concepto === "comision_asesor");
    expect(comision?.[0]).toMatchObject({ direccion: "egreso", monto: 50 });
  });

  it("avisa al cliente solo cuando terminó de pagar", async () => {
    mockGestion({ ...BASE });
    mockUpdateResult({ ...BASE, valorPagado: 200, estadoPago: "parcial" });
    await registrarAbono("g1", { monto: 200 }, "u1", "Oscar");
    expect(mocks.createAndSendNotification).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mocks.postFinancialMovement.mockResolvedValue({});
    mockGestion({ ...BASE, valorPagado: 200 });
    mockUpdateResult({ ...BASE, valorPagado: 500, estadoPago: "confirmado", pagoConfirmadoEn: new Date() });
    await registrarAbono("g1", { monto: 300 }, "u1", "Oscar");
    expect(mocks.createAndSendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ evento: "pago_confirmado" }),
    );
  });

  it("guarda quién registró el abono y con qué método", async () => {
    mockGestion({ ...BASE });
    mockUpdateResult({ ...BASE, valorPagado: 100 });

    await registrarAbono("g1", { monto: 100, metodo: "efectivo", referencia: "REC-88" }, "u1", "Oscar");

    expect(mocks.findOneAndUpdate.mock.calls[0][1].$push.abonos).toMatchObject({
      monto: 100,
      metodo: "efectivo",
      referencia: "REC-88",
      registradoPor: "u1",
      registradoPorNombre: "Oscar",
    });
  });

  it("devuelve null si la gestión no existe", async () => {
    mockGestion(null);
    expect(await registrarAbono("nope", { monto: 10 }, "u1", "Oscar")).toBeNull();
  });
});

describe("confirmarPago", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.postFinancialMovement.mockResolvedValue({});
    mocks.createAndSendNotification.mockResolvedValue(undefined);
  });

  it("salda el pendiente completo cuando no se pasa un monto", async () => {
    const lean = vi.fn()
      .mockResolvedValueOnce({ valorTotal: 500, valorPagado: 200 })
      .mockResolvedValue({ ...BASE, valorPagado: 200 });
    mocks.findById.mockReturnValue({ lean, select: vi.fn().mockReturnValue({ lean }) });
    mockUpdateResult({ ...BASE, valorPagado: 500, estadoPago: "confirmado" });

    await confirmarPago("g1", NaN, "u1", "Oscar");

    expect(mocks.findOneAndUpdate.mock.calls[0][1].$set.valorPagado).toBe(500);
  });
});
