import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findOne: vi.fn(), updateOne: vi.fn() }));
vi.mock("../models/index", () => ({ models: { configuraciones: { findOne: mocks.findOne, updateOne: mocks.updateOne } } }));

import { guardarIvaPorcentaje, limpiarCacheIva, obtenerIvaPorcentaje } from "./configuracion_facturacion.service";

const lean = (v: unknown) => ({ lean: vi.fn().mockResolvedValue(v) });

describe("IVA global", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    limpiarCacheIva();
    mocks.updateOne.mockResolvedValue({});
  });

  it("es 15 % si nadie lo cambió", async () => {
    mocks.findOne.mockReturnValue(lean(null));
    expect(await obtenerIvaPorcentaje()).toBe(15);
  });

  it("devuelve el guardado y lo recuerda un rato", async () => {
    mocks.findOne.mockReturnValue(lean({ valor: 0 }));
    expect(await obtenerIvaPorcentaje()).toBe(0);
    expect(await obtenerIvaPorcentaje()).toBe(0);
    expect(mocks.findOne).toHaveBeenCalledTimes(1);
  });

  it("guarda sólo porcentajes válidos y actualiza lo que se lee", async () => {
    await expect(guardarIvaPorcentaje(13)).rejects.toThrow(/uno de/);
    expect(mocks.updateOne).not.toHaveBeenCalled();

    expect(await guardarIvaPorcentaje("12", "admin@x.com")).toBe(12);
    expect(mocks.updateOne).toHaveBeenCalledWith({ clave: "facturacion.ivaPorcentaje" }, { $set: { valor: 12, actualizadoPor: "admin@x.com" } }, { upsert: true });
    expect(await obtenerIvaPorcentaje()).toBe(12);
  });

  it("ignora un valor raro en la base y vuelve al 15 %", async () => {
    mocks.findOne.mockReturnValue(lean({ valor: "abc" }));
    expect(await obtenerIvaPorcentaje()).toBe(15);
  });
});
