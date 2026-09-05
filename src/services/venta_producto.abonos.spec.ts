import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  findOneAndUpdate: vi.fn(),
  movFindOne: vi.fn(),
  movUpdateOne: vi.fn(),
  postFinancialMovement: vi.fn(),
}));

vi.mock("../models/index.js", () => ({
  models: {
    ventasProducto: {
      findById: mocks.findById,
      findOneAndUpdate: mocks.findOneAndUpdate,
    },
    movimientosFinancieros: {
      findOne: mocks.movFindOne,
      updateOne: mocks.movUpdateOne,
    },
  },
}));

vi.mock("./financial-movement.service.js", () => ({
  postFinancialMovement: mocks.postFinancialMovement,
  reverseFinancialMovements: vi.fn(),
}));

import {
  eliminarAbonoVenta,
  estadoPagoFor,
  normalizeMetodo,
  registrarAbonoVenta,
  settleCuotas,
  syncComisionMovement,
  planPagoMigrado,
  updateDesdeRespaldo,
} from "./venta_producto.service";

function mockVenta(venta: Record<string, unknown> | null) {
  mocks.findById.mockReturnValue({ lean: vi.fn().mockResolvedValue(venta) });
}

function mockUpdateResult(venta: Record<string, unknown> | null) {
  mocks.findOneAndUpdate.mockReturnValue({ lean: vi.fn().mockResolvedValue(venta) });
}

const BASE = {
  _id: "v1",
  total: 100,
  valorPagado: 0,
  cantidad: 2,
  comisionUnitaria: 5,
  clienteId: "c1",
  vendedorId: "u9",
  cuotas: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.movFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue(null) });
  mocks.movUpdateOne.mockResolvedValue({});
});

describe("estadoPagoFor", () => {
  it("marca pendiente una venta entregada sin cobrar", () => {
    expect(estadoPagoFor(100, 0)).toBe("pendiente");
  });

  it("marca parcial mientras quede saldo", () => {
    expect(estadoPagoFor(100, 40)).toBe("parcial");
  });

  it("marca pagado al llegar al total", () => {
    expect(estadoPagoFor(100, 100)).toBe("pagado");
  });
});

describe("normalizeMetodo", () => {
  it("acepta el texto libre que escribe el vendedor", () => {
    expect(normalizeMetodo("TRANSFERENCIA")).toBe("transferencia");
    expect(normalizeMetodo("Depósito")).toBe("deposito");
    expect(normalizeMetodo("Tarjeta de crédito")).toBe("tarjeta");
  });

  it("archiva como otro lo que no reconoce, en vez de perder el pago", () => {
    expect(normalizeMetodo("criptomoneda")).toBe("otro");
  });
});

describe("settleCuotas", () => {
  const cuotas = [
    { fecha: new Date("2026-09-10"), monto: 30, pagada: false, recordatorioEnviado: false },
    { fecha: new Date("2026-10-10"), monto: 30, pagada: false, recordatorioEnviado: false },
  ];

  it("no da por pagada una cuota con el abono de entrada", () => {
    // $100 total, $40 de entrada, $60 diferido: la entrada no adelanta cuotas.
    expect(settleCuotas(cuotas, 100, 40).map((c) => c.pagada)).toEqual([false, false]);
  });

  it("salda las cuotas en orden de fecha a medida que entra el dinero", () => {
    expect(settleCuotas(cuotas, 100, 70).map((c) => c.pagada)).toEqual([true, false]);
    expect(settleCuotas(cuotas, 100, 100).map((c) => c.pagada)).toEqual([true, true]);
  });
});

describe("registrarAbonoVenta", () => {
  it("acumula el pago y deja la venta en parcial", async () => {
    mockVenta({ ...BASE });
    mockUpdateResult({ ...BASE, valorPagado: 40, saldo: 60, estadoPago: "parcial" });

    await registrarAbonoVenta("v1", { monto: 40 }, "u1", "oscar@courierbox.ec");

    const [filter, update] = mocks.findOneAndUpdate.mock.calls[0]!;
    expect(filter).toEqual({ _id: "v1", valorPagado: 0 });
    expect(update.$set.valorPagado).toBe(40);
    expect(update.$set.saldo).toBe(60);
    expect(update.$set.estadoPago).toBe("parcial");
    expect(update.$set.pagoConfirmado).toBe(false);
  });

  it("registra el ingreso en el estado de resultados", async () => {
    mockVenta({ ...BASE });
    mockUpdateResult({ ...BASE, valorPagado: 40, saldo: 60, estadoPago: "parcial" });

    await registrarAbonoVenta("v1", { monto: 40 }, "u1", "oscar@courierbox.ec");

    const movimiento = mocks.postFinancialMovement.mock.calls[0]![0];
    expect(movimiento).toMatchObject({
      direccion: "ingreso",
      origen: "venta",
      origenId: "v1",
      categoria: "VENTA_PRODUCTO",
      monto: 40,
    });
  });

  it("cierra la venta y paga la comisión al saldar", async () => {
    mockVenta({ ...BASE, valorPagado: 60 });
    mockUpdateResult({ ...BASE, valorPagado: 100, saldo: 0, estadoPago: "pagado" });

    await registrarAbonoVenta("v1", { monto: 40 }, "u1", "oscar@courierbox.ec");

    const [, update] = mocks.findOneAndUpdate.mock.calls[0]!;
    expect(update.$set.estadoPago).toBe("pagado");
    expect(update.$set.pagoConfirmado).toBe(true);

    const comision = mocks.postFinancialMovement.mock.calls.find(
      (c) => c[0].categoria === "COMISION"
    )?.[0];
    expect(comision).toMatchObject({ direccion: "egreso", monto: 10 });
  });

  it("no deja cobrar más que el saldo pendiente", async () => {
    mockVenta({ ...BASE, valorPagado: 80 });
    await expect(registrarAbonoVenta("v1", { monto: 40 }, "u1", "o@c.ec")).rejects.toThrow(
      "supera el saldo pendiente de $20.00"
    );
  });

  it("rechaza un abono sobre una venta ya saldada", async () => {
    mockVenta({ ...BASE, valorPagado: 100 });
    await expect(registrarAbonoVenta("v1", { monto: 10 }, "u1", "o@c.ec")).rejects.toThrow(
      "ya está pagada por completo"
    );
  });

  it("rechaza montos que no son dinero", async () => {
    mockVenta({ ...BASE });
    await expect(registrarAbonoVenta("v1", { monto: 0 }, "u1", "o@c.ec")).rejects.toThrow(
      "mayor a cero"
    );
    await expect(registrarAbonoVenta("v1", { monto: -5 }, "u1", "o@c.ec")).rejects.toThrow(
      "mayor a cero"
    );
  });

  it("aborta si otro cobro movió el saldo mientras tanto", async () => {
    mockVenta({ ...BASE });
    mockUpdateResult(null);
    await expect(registrarAbonoVenta("v1", { monto: 40 }, "u1", "o@c.ec")).rejects.toThrow(
      "El saldo cambió"
    );
  });
});

describe("eliminarAbonoVenta", () => {
  const conAbono = {
    ...BASE,
    valorPagado: 40,
    abonos: [{ _id: "507f1f77bcf86cd799439011", monto: 40 }],
  };

  it("devuelve el saldo y reversa el ingreso", async () => {
    mockVenta({ ...conAbono });
    mockUpdateResult({ ...BASE, valorPagado: 0, saldo: 100, estadoPago: "pendiente" });
    mocks.movFindOne
      .mockReturnValueOnce({
        lean: vi.fn().mockResolvedValue({
          _id: "m1",
          base: "devengado",
          categoria: "VENTA_PRODUCTO",
          monto: 40,
        }),
      })
      .mockReturnValue({ lean: vi.fn().mockResolvedValue(null) });

    await eliminarAbonoVenta("v1", "507f1f77bcf86cd799439011", "u1");

    const [, update] = mocks.findOneAndUpdate.mock.calls[0]!;
    expect(update.$set.valorPagado).toBe(0);
    expect(update.$set.estadoPago).toBe("pendiente");

    const reverso = mocks.postFinancialMovement.mock.calls.find((c) =>
      String(c[0].concepto).startsWith("reverso:")
    )?.[0];
    expect(reverso).toMatchObject({ direccion: "egreso", monto: 40 });
  });

  it("no borra un abono que no pertenece a la venta", async () => {
    mockVenta({ ...conAbono });
    await expect(eliminarAbonoVenta("v1", "507f1f77bcf86cd799439099", "u1")).rejects.toThrow(
      "Abono no encontrado"
    );
  });
});

describe("syncComisionMovement", () => {
  const pagada = { _id: "v1", estadoPago: "pagado", cantidad: 2, comisionUnitaria: 5, vendedorId: "u9" };

  it("publica la comisión una sola vez", async () => {
    await syncComisionMovement(pagada as any, "u1");
    expect(mocks.postFinancialMovement).toHaveBeenCalledTimes(1);
    expect(mocks.postFinancialMovement.mock.calls[0]![0]).toMatchObject({
      concepto: "comision_vendedor:1000",
      monto: 10,
    });
  });

  it("no republica si ya existe por el mismo monto", async () => {
    mocks.movFindOne.mockReturnValue({
      lean: vi.fn().mockResolvedValue({ _id: "m1", monto: 10, estado: "confirmado" }),
    });
    await syncComisionMovement(pagada as any, "u1");
    expect(mocks.postFinancialMovement).not.toHaveBeenCalled();
  });

  it("anula la comisión anterior cuando la venta se re-tarifa", async () => {
    // Primera consulta: la comisión vigente. Segunda: la del monto nuevo.
    mocks.movFindOne
      .mockReturnValueOnce({ lean: vi.fn().mockResolvedValue({ _id: "m1", monto: 10, estado: "confirmado" }) })
      .mockReturnValue({ lean: vi.fn().mockResolvedValue(null) });

    await syncComisionMovement({ ...pagada, comisionUnitaria: 8 } as any, "u1");

    expect(mocks.movUpdateOne).toHaveBeenCalledWith(
      { _id: "m1" },
      expect.objectContaining({ $set: expect.objectContaining({ estado: "anulado" }) })
    );
    expect(mocks.postFinancialMovement.mock.calls[0]![0]).toMatchObject({ concepto: "comision_vendedor:1600" });
  });

  it("revive la comisión anulada si la venta vuelve a su monto anterior", async () => {
    mocks.movFindOne
      .mockReturnValueOnce({ lean: vi.fn().mockResolvedValue({ _id: "m2", monto: 16, estado: "confirmado" }) })
      .mockReturnValueOnce({ lean: vi.fn().mockResolvedValue({ _id: "m1", monto: 10, estado: "anulado" }) });

    await syncComisionMovement(pagada as any, "u1");

    // Sin revivirla, postFinancialMovement encontraría la fila anulada, no
    // insertaría nada y la comisión desaparecería en silencio.
    expect(mocks.postFinancialMovement).not.toHaveBeenCalled();
    expect(mocks.movUpdateOne).toHaveBeenCalledWith(
      { _id: "m1" },
      expect.objectContaining({ $set: expect.objectContaining({ estado: "confirmado" }) })
    );
  });

  it("retira la comisión si la venta deja de estar pagada", async () => {
    mocks.movFindOne.mockReturnValue({
      lean: vi.fn().mockResolvedValue({ _id: "m1", monto: 10, estado: "confirmado" }),
    });

    await syncComisionMovement({ ...pagada, estadoPago: "parcial" } as any, "u1");

    expect(mocks.movUpdateOne).toHaveBeenCalledWith(
      { _id: "m1" },
      expect.objectContaining({ $set: expect.objectContaining({ estado: "anulado" }) })
    );
    expect(mocks.postFinancialMovement).not.toHaveBeenCalled();
  });
});

describe("planPagoMigrado", () => {
  it("toma el depósito de una venta a crédito", () => {
    const plan = planPagoMigrado({ total: 100, abono: 40, saldo: 60, esCredito: true });
    expect(plan).toMatchObject({ valorPagado: 40, saldo: 60, estadoPago: "parcial" });
  });

  it("da por cobrada la venta al contado confirmada", () => {
    const plan = planPagoMigrado({ total: 35, esCredito: false, pagoConfirmado: true });
    expect(plan).toMatchObject({ valorPagado: 35, saldo: 0, estadoPago: "pagado" });
  });

  it("destapa la deuda de la venta entregada sin cobrar", () => {
    // El caso de Oscar: saldo 0 guardado, pero nadie pagó nada.
    const plan = planPagoMigrado({ total: 35, saldo: 0, esCredito: false, pagoConfirmado: false });
    expect(plan).toMatchObject({ valorPagado: 0, saldo: 35, estadoPago: "pendiente" });
    expect(plan.deudaOculta).toBe(35);
  });

  it("no cuenta como deuda oculta la que el registro ya declaraba", () => {
    const plan = planPagoMigrado({ total: 100, abono: 40, saldo: 60, esCredito: true });
    expect(plan.deudaOculta).toBe(0);
  });

  it("nunca deja el pagado por encima del total", () => {
    const plan = planPagoMigrado({ total: 50, abono: 80, esCredito: true });
    expect(plan.valorPagado).toBe(50);
    expect(plan.saldo).toBe(0);
  });
});

describe("updateDesdeRespaldo", () => {
  it("restaura los valores guardados", () => {
    const update = updateDesdeRespaldo({ valorPagado: 40, saldo: 60, estadoPago: "parcial" }) as any;
    expect(update.$set).toMatchObject({ valorPagado: 40, saldo: 60, estadoPago: "parcial" });
  });

  it("desetea lo que el documento no tenía, en vez de escribir null", () => {
    // Una venta previa a la migración no tenía `abonos` ni `estadoPago`;
    // devolverlos como null sería un tercer estado, no el original.
    const update = updateDesdeRespaldo({ saldo: 0 }) as any;
    expect(update.$unset).toHaveProperty("abonos");
    expect(update.$unset).toHaveProperty("estadoPago");
    expect(update.$set).not.toHaveProperty("abonos");
  });

  it("sobrevive el viaje de ida y vuelta por JSON del archivo de respaldo", () => {
    const original = { valorPagado: 40, saldo: 60, estadoPago: "parcial", abonos: [], cuotas: [] };
    const update = updateDesdeRespaldo(JSON.parse(JSON.stringify(original))) as any;
    expect(update.$set).toEqual(original);
    expect(update.$unset).toEqual({ pagoConfirmado: "", pagoCompletadoEn: "" });
  });
});
