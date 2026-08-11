import { describe, expect, it } from "vitest";
import { Notificacion } from "./notificacion.model";

describe("Notificacion schema", () => {
  it("validates a WhatsApp-only contact with no email", () => {
    // Regression: `destinatario` used to be required, so a contact reachable
    // only by WhatsApp made save() throw *after* the upsert had inserted the
    // row — leaving it stuck in `enviando` with no entregas.
    const doc = new Notificacion({
      evento: "retiro_counter",
      destinatario: "",
      destinatarioTelefono: "0991234567",
      destinatarioNombre: "Ana Pérez",
      operacionTipo: "envio",
      operacionId: "6a7a1a22c65182a3aea6733c",
      idempotencyKey: "envio:1:retiro_counter",
      canales: ["email", "whatsapp"],
      payload: { folio: "ABC12345" },
    });

    const error = doc.validateSync();
    expect(error).toBeUndefined();
  });

  it("accepts the listo state and the composed message on an entrega", () => {
    const doc = new Notificacion({
      evento: "retiro_counter",
      destinatario: "ana@mail.com",
      operacionTipo: "envio",
      operacionId: "6a7a1a22c65182a3aea6733c",
      idempotencyKey: "envio:2:retiro_counter",
      canales: ["email", "whatsapp"],
      entregas: [
        { canal: "email", estado: "omitida", intentos: 1 },
        {
          canal: "whatsapp",
          estado: "listo",
          intentos: 1,
          mensaje: "Hola Courier Box…",
          enlace: "https://wa.me/13478248937?text=Hola",
        },
      ],
      payload: {},
    });

    expect(doc.validateSync()).toBeUndefined();
    expect(doc.entregas[1]!.enlace).toContain("wa.me/13478248937");
  });

  it("rejects an unknown channel", () => {
    const doc = new Notificacion({
      evento: "retiro_counter",
      operacionTipo: "envio",
      operacionId: "6a7a1a22c65182a3aea6733c",
      idempotencyKey: "envio:3:retiro_counter",
      canales: ["telegram"] as never,
      payload: {},
    });

    expect(doc.validateSync()).toBeDefined();
  });

  it("accepts parcial as an aggregate state", () => {
    const doc = new Notificacion({
      evento: "retiro_counter",
      operacionTipo: "envio",
      operacionId: "6a7a1a22c65182a3aea6733c",
      idempotencyKey: "envio:4:retiro_counter",
      estado: "parcial",
      payload: {},
    });

    expect(doc.validateSync()).toBeUndefined();
  });
});
