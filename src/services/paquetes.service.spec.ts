import mongoose from "mongoose";
import { describe, expect, it, vi } from "vitest";

vi.mock("../models/index", () => ({ models: {} }));

import { construirFiltro, normalizarAgencias } from "./paquetes.service";

const sinClientes = async () => [];

describe("construirFiltro de warehouses", () => {
  it("sin filtros trae todo", async () => {
    expect(await construirFiltro({}, sinClientes)).toEqual({});
  });

  it("ignora un estado que no existe", async () => {
    expect(await construirFiltro({ estado: "borrado" }, sinClientes)).toEqual({});
    expect(await construirFiltro({ estado: "validado" }, sinClientes)).toEqual({ estado: "validado" });
  });

  it("separa con y sin factura", async () => {
    expect(await construirFiltro({ facturado: "no" }, sinClientes)).toEqual({ facturaId: null });
    expect(await construirFiltro({ facturado: "si" }, sinClientes)).toEqual({ facturaId: { $ne: null } });
  });

  it("la agencia empareja aunque el manifiesto deje espacios o minúsculas", async () => {
    const f = await construirFiltro({ agencia: "GRACIA BOX" }, sinClientes);
    expect((f.agencia as RegExp).test(" gracia  box ")).toBe(true);
    expect((f.agencia as RegExp).test("GRACIA BOX EXPRESS")).toBe(false);
  });

  it("el rango de fechas va en hora de Ecuador e incluye el día final completo", async () => {
    const f = await construirFiltro({ desde: "2026-10-01", hasta: "2026-10-05" }, sinClientes);
    const rango = ((f.$and as any[])[0].$or[0].fechaIngreso) as { $gte: Date; $lt: Date };
    expect(rango.$gte.toISOString()).toBe("2026-10-01T05:00:00.000Z");
    expect(rango.$lt.toISOString()).toBe("2026-10-06T05:00:00.000Z");
  });

  it("la búsqueda cubre WR, tracking y los clientes que coinciden", async () => {
    const clienteId = new mongoose.Types.ObjectId();
    const f = await construirFiltro({ q: "wr8896" }, async () => [clienteId]);
    const or = f.$or as Record<string, unknown>[];
    expect((or[0].wr as RegExp).test("WR889628")).toBe(true);
    expect(or).toContainEqual({ masterClienteId: { $in: [clienteId] } });
  });

  it("escapa caracteres especiales de la búsqueda", async () => {
    const f = await construirFiltro({ q: "WR(1" }, sinClientes);
    expect(() => (f.$or as any[])[0].wr.test("x")).not.toThrow();
  });
});

describe("normalizarAgencias", () => {
  it("une variantes y descarta vacíos", () => {
    expect(normalizarAgencias(["COURIER BOX ", "courier  box", "", "GRACIA BOX", null as unknown as string])).toEqual([
      "COURIER BOX",
      "GRACIA BOX",
    ]);
  });
});
