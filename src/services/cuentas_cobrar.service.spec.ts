import { describe, expect, it } from "vitest";
import { armarResumen, calcularEstado, hoyEcuador } from "./cuentas_cobrar.service";

const HOY = "2026-10-19";
const cuenta = (o: Record<string, unknown> = {}) => ({
  _id: Math.random().toString(36),
  cliente: "Cliente",
  tipo: "courier",
  asesor: "",
  monto: 100,
  fechaPago: "",
  fechaCobro: "",
  abonos: [] as { monto: number }[],
  ...o,
});

describe("calcularEstado", () => {
  it("sin abonos ni fecha vencida queda pendiente", () => {
    expect(calcularEstado(cuenta({ fechaPago: "2026-10-25" }), HOY)).toEqual({ abonado: 0, saldo: 100, estado: "pendiente" });
  });

  it("con abono parcial queda abonado y descuenta el saldo", () => {
    expect(calcularEstado(cuenta({ abonos: [{ monto: 30.5 }] }), HOY)).toEqual({ abonado: 30.5, saldo: 69.5, estado: "abonado" });
  });

  it("fecha de pago pasada con saldo es atrasado, aunque tenga abonos", () => {
    expect(calcularEstado(cuenta({ fechaPago: "2026-10-18", abonos: [{ monto: 10 }] }), HOY).estado).toBe("atrasado");
  });

  it("vence hoy todavía no está atrasado", () => {
    expect(calcularEstado(cuenta({ fechaPago: HOY }), HOY).estado).toBe("pendiente");
  });

  it("abonos que cubren el monto la dejan pagada, sin saldo negativo", () => {
    expect(calcularEstado(cuenta({ fechaPago: "2026-01-01", abonos: [{ monto: 60 }, { monto: 40 }] }), HOY)).toEqual({
      abonado: 100,
      saldo: 0,
      estado: "pagado",
    });
  });

  it("redondea centavos de sumas flotantes", () => {
    expect(calcularEstado(cuenta({ monto: 0.3, abonos: [{ monto: 0.1 }, { monto: 0.2 }] }), HOY).estado).toBe("pagado");
  });
});

describe("armarResumen", () => {
  it("separa cobrar hoy, vencen hoy y atrasadas sin repetir cuentas", () => {
    const cobrar = cuenta({ cliente: "A", fechaCobro: HOY, fechaPago: "2026-10-01" });
    const vence = cuenta({ cliente: "B", fechaPago: HOY });
    const atrasadaChica = cuenta({ cliente: "C", fechaPago: "2026-10-10", monto: 50 });
    const atrasadaGrande = cuenta({ cliente: "D", fechaPago: "2026-09-10", monto: 900 });
    const pagada = cuenta({ cliente: "E", fechaCobro: HOY, abonos: [{ monto: 100 }] });
    const futura = cuenta({ cliente: "F", fechaPago: "2026-11-01" });

    const r = armarResumen([cobrar, vence, atrasadaChica, atrasadaGrande, pagada, futura], HOY);

    expect(r.cobrarHoy.map((f) => f.cliente)).toEqual(["A"]);
    expect(r.vencenHoy.map((f) => f.cliente)).toEqual(["B"]);
    // "A" también está atrasada pero ya sale en "cobrar hoy"; las atrasadas van de mayor a menor saldo.
    expect(r.atrasadas.map((f) => f.cliente)).toEqual(["D", "C"]);
    expect(r.totalPendiente).toBe(100 + 100 + 50 + 900 + 100);
    expect(r.totalAtrasado).toBe(100 + 50 + 900);
  });
});

describe("hoyEcuador", () => {
  it("usa la hora de Ecuador, no UTC", () => {
    // 03:00 UTC del 20 = 22:00 del 19 en Guayaquil.
    expect(hoyEcuador(new Date("2026-10-20T03:00:00Z"))).toBe("2026-10-19");
  });
});
