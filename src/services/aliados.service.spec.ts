import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  count: vi.fn(),
  insertMany: vi.fn(),
  exists: vi.fn(),
  create: vi.fn(),
  findById: vi.fn(),
  findByIdAndUpdate: vi.fn(),
}));

vi.mock("../models/index", () => ({
  models: {
    aliados: {
      countDocuments: mocks.count,
      insertMany: mocks.insertMany,
      exists: mocks.exists,
      create: mocks.create,
      findById: mocks.findById,
      findByIdAndUpdate: mocks.findByIdAndUpdate,
    },
  },
}));

import { ALIADOS_DEFECTO, actualizarAliado, aliadoDeAgencia, crearAliado } from "./aliados.service";

const lean = (v: unknown) => ({ lean: vi.fn().mockResolvedValue(v) });

describe("aliadoDeAgencia", () => {
  const codigo = (agencia: unknown, lista = ALIADOS_DEFECTO) => aliadoDeAgencia(agencia, lista)?.codigo;

  it("reconoce al aliado aunque el manifiesto lo escriba distinto", () => {
    expect(codigo("GRACIA BOX")).toBe("GRACIABOX");
    expect(codigo(" graciabox ")).toBe("GRACIABOX");
    expect(codigo("Te Lo Traemos")).toBe("TELOTRAEMOS");
    expect(codigo("QUICK CARGO")).toBe("QUIKCARGO");
  });

  it("lo que no es de un aliado es de Courier Box", () => {
    expect(codigo("COURIER BOX")).toBe("COURIERBOX");
    expect(codigo("FARMASI MP")).toBe("COURIERBOX");
    expect(codigo("")).toBe("COURIERBOX");
    expect(codigo(null)).toBe("COURIERBOX");
  });

  it("un aliado desactivado deja de reconocerse", () => {
    const lista = ALIADOS_DEFECTO.map((a) => (a.codigo === "GRACIABOX" ? { ...a, activo: false } : a));
    expect(codigo("GRACIA BOX", lista)).toBe("COURIERBOX");
  });
});

describe("crearAliado / actualizarAliado", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.exists.mockResolvedValue(null);
    mocks.create.mockImplementation(async (doc: any) => ({ toObject: () => doc }));
  });

  it("crea con código, marca y coincidencia a partir del nombre", async () => {
    const a = await crearAliado({ nombre: "Envíos Ya", tarifaFleteLb: "4,25" });
    expect(a).toMatchObject({ codigo: "ENVIOSYA", marca: "ENVÍOS YA", coincidencias: ["ENVÍOS YA"], tarifaFleteLb: 4.25, tarifaArancelLb: null, principal: false });
  });

  it("rechaza tarifas absurdas y logos que no son https", async () => {
    await expect(crearAliado({ nombre: "X", tarifaFleteLb: "-1" })).rejects.toMatchObject({ status: 400 });
    await expect(crearAliado({ nombre: "X", logoUrl: "http://x/logo.png" })).rejects.toMatchObject({ status: 400 });
  });

  it("no deja repetir un código", async () => {
    mocks.exists.mockResolvedValue({ _id: "1" });
    await expect(crearAliado({ nombre: "Gracia Box" })).rejects.toMatchObject({ status: 409 });
  });

  it("Courier Box no se puede desactivar", async () => {
    mocks.findById.mockReturnValue(lean({ _id: "1", principal: true }));
    mocks.findByIdAndUpdate.mockReturnValue(lean({}));
    await actualizarAliado("507f1f77bcf86cd799439011", { activo: false, tarifaFleteLb: "" });
    expect(mocks.findByIdAndUpdate.mock.calls[0][1].$set).toMatchObject({ activo: true, tarifaFleteLb: null });
  });
});
