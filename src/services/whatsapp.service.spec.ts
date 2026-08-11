import { describe, expect, it } from "vitest";
import {
  buildWhatsappMessage,
  composeWhatsappNotification,
  normalizePhone,
} from "./whatsapp.service";

const COURIER_LINE = "13478248937";

describe("normalizePhone", () => {
  it("expands a local Ecuadorian mobile to E.164", () => {
    expect(normalizePhone("0991234567")).toBe("+593991234567");
  });

  it("accepts a 9-digit mobile without the leading zero", () => {
    expect(normalizePhone("991234567")).toBe("+593991234567");
  });

  it("keeps an already-prefixed number untouched", () => {
    expect(normalizePhone("+593991234567")).toBe("+593991234567");
  });

  it("strips formatting characters before normalising", () => {
    expect(normalizePhone("(099) 123-4567")).toBe("+593991234567");
  });

  it("returns an empty string for missing or unusable input", () => {
    expect(normalizePhone("")).toBe("");
    expect(normalizePhone(undefined)).toBe("");
    expect(normalizePhone("sin teléfono")).toBe("");
  });
});

describe("buildWhatsappMessage", () => {
  it("names the client and the retiro folio", () => {
    const msg = buildWhatsappMessage(
      "retiro_counter",
      { folio: "ABC12345", totalPaquetes: 3 },
      "Ana Pérez"
    );
    expect(msg).toContain("Ana Pérez");
    expect(msg).toContain("ABC12345");
    expect(msg).toContain("3");
  });

  it("formats money for the purchase events", () => {
    const msg = buildWhatsappMessage("gestion_creada", { valorTotal: 120.5 }, "Luis Mora");
    expect(msg).toContain("$120.50");
  });

  it("omits optional context instead of printing empty fragments", () => {
    const msg = buildWhatsappMessage("envio_en_camino", {}, "Ana");
    expect(msg).not.toContain("undefined");
    expect(msg).not.toContain("  ");
  });
});

describe("composeWhatsappNotification", () => {
  it("returns a click-to-chat link against the Courier Box line", () => {
    const result = composeWhatsappNotification({
      evento: "retiro_counter",
      nombre: "Ana Pérez",
      payload: { folio: "ABC12345", totalPaquetes: 2 },
    });

    expect(result.ready).toBe(true);
    expect(result.enlace).toContain(`https://wa.me/${COURIER_LINE}?text=`);
    // The composed body must survive the round trip through the query string.
    const encoded = result.enlace!.split("?text=")[1]!;
    expect(decodeURIComponent(encoded)).toBe(result.mensaje);
  });

  it("percent-encodes the message so accents and spaces stay intact", () => {
    const result = composeWhatsappNotification({
      evento: "retiro_counter",
      nombre: "Ana Pérez",
      payload: { folio: "X1", totalPaquetes: 1 },
    });
    expect(result.enlace).not.toContain(" ");
    expect(decodeURIComponent(result.enlace!)).toContain("Ana Pérez");
  });

  it("skips when there is no name to address the message with", () => {
    const result = composeWhatsappNotification({
      evento: "retiro_counter",
      nombre: "",
      payload: {},
    });
    expect(result.ready).toBe(false);
    expect(result.skipped).toBe(true);
    expect(result.enlace).toBeUndefined();
  });

  it("never reports success — delivery is manual by design", () => {
    const result = composeWhatsappNotification({
      evento: "entrega_completada",
      nombre: "Ana",
      payload: {},
    });
    expect(result).not.toHaveProperty("success");
    expect(result.ready).toBe(true);
  });
});
