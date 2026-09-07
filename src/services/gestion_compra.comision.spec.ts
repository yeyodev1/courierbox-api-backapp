import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ calculateFee: vi.fn() }));

vi.mock("../models/index.js", () => ({ models: { gestionesCompra: {} } }));
vi.mock("./fee.service.js", () => ({ calculateFee: mocks.calculateFee }));
vi.mock("./financial-movement.service.js", () => ({ postFinancialMovement: vi.fn() }));
vi.mock("../services/financial-movement.service.js", () => ({ postFinancialMovement: vi.fn() }));
vi.mock("./notification.service.js", () => ({ createAndSendNotification: vi.fn() }));
vi.mock("../config/env.js", () => ({ env: { FRONTEND_ORIGIN: ["https://courierboxlogistics.com"] } }));
vi.mock("../middleware/auth.middleware.js", () => ({ getCurrentAuthUser: vi.fn() }));

import { calcularComisionPreview } from "./gestion_compra.service";

describe("calcularComisionPreview", () => {
  beforeEach(() => vi.clearAllMocks());

  it("marca como calculada la comisión que sale de una regla", async () => {
    mocks.calculateFee.mockResolvedValue({ feeAmount: 12.5, configName: "Regla estándar", ruleType: "percentage" });

    const result = await calcularComisionPreview(100);

    expect(result).toMatchObject({ valorComision: 12.5, feeConfigNombre: "Regla estándar", calculada: true });
  });

  /**
   * Un cero de "la regla dice cero" y un cero de "no hay regla" se veían igual,
   * y el wizard guardaba los dos. `calculada` los separa.
   */
  it("distingue un cero sin regla de un cero calculado", async () => {
    mocks.calculateFee.mockResolvedValue({ feeAmount: 0, configName: "Sin configurar", ruleType: "none" });

    const result = await calcularComisionPreview(100);

    expect(result.calculada).toBe(false);
    expect(result.motivo).toContain("no configura");
  });

  it("una regla que legítimamente da cero sigue siendo calculada", async () => {
    mocks.calculateFee.mockResolvedValue({ feeAmount: 0, configName: "Clientes internos", ruleType: "fixed" });

    const result = await calcularComisionPreview(100);

    expect(result).toMatchObject({ valorComision: 0, calculada: true });
  });

  it("no calcula nada cuando el cálculo falla", async () => {
    mocks.calculateFee.mockRejectedValue(new Error("db caída"));

    const result = await calcularComisionPreview(100);

    expect(result).toMatchObject({ valorComision: 0, calculada: false });
    expect(result.motivo).toBeTruthy();
  });
});
