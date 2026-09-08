import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }));

vi.mock("axios", () => ({
  default: { create: () => ({ get: mocks.get, post: mocks.post, put: mocks.put }) },
}));

vi.mock("../config/env", () => ({
  env: {
    CONTIFICO_API_URL: "https://api.contifico.com/sistema/api/v1",
    CONTIFICO_API_KEY: "clave-de-prueba",
    CONTIFICO_TOKEN: "token-pos-de-prueba",
    CONTIFICO_ESTABLECIMIENTO: "001",
    CONTIFICO_PUNTO_EMISION: "001",
    CONTIFICO_PRODUCTO_FLETE: "CATB01",
    CONTIFICO_PRODUCTO_ARANCEL: "REEMB",
  },
}));

import {
  armarDetalles,
  clienteContifico,
  emailParaContifico,
  diagnostico,
  emitirFactura,
  fechaContifico,
  limpiarCacheProductos,
  mapearEstadoSri,
  registrarCobro,
  siguienteNumero,
} from "./contifico.service";

/** Lo que devuelve la cuenta real de Courier Box: la 888 es la última emitida a mano. */
const LISTA_FACTURAS = [
  { id: "JvaMrY0N6CNplbpz", documento: "001-001-000000888" },
  { id: "pgen3BpkVC845aNQ", documento: "001-001-000000887" },
  { id: "otro", documento: "002-001-000009999" }, // otro punto de emisión: no cuenta
];

async function respuestaGet(url: string, config?: any) {
  if (url === "/producto/") {
    const codigo = config?.params?.codigo;
    if (codigo === "CATB01") return { data: [{ id: "ZxgepMDg5iYgDa1p", codigo: "CATB01", nombre: "Courier Services" }] };
    if (codigo === "REEMB") return { data: [{ id: "MEegJ9l7BTMvkdQ5", codigo: "REEMB", nombre: "REEMBOLSO DE IMPUESTOS" }] };
    return { data: [] };
  }
  if (url === "/documento/") return { data: LISTA_FACTURAS };
  if (/\/documento\/[^/]+\/estado\/$/.test(url)) return { data: { estado: "Autorizado" } };
  if (/\/documento\/[^/]+\/$/.test(url)) {
    return {
      data: {
        id: "nuevo123",
        documento: "001-001-000000889",
        autorizacion: "0709202601099338854900120010010000008891234567890",
        url_ride: "https://0993388549001.contifico.com/ride/x.pdf",
        url_xml: "https://0993388549001.contifico.com/xml/x/",
      },
    };
  }
  return { data: {} };
}

describe("contifico — bloques del documento", () => {
  it("autentica con la API key cruda en Authorization, sin Bearer", async () => {
    mocks.get.mockImplementation(respuestaGet);
    await siguienteNumero();
    const config = mocks.get.mock.calls[0][1];
    expect(config.headers.Authorization).toBe("clave-de-prueba");
  });

  it("toma el siguiente número a la última factura de nuestro punto de emisión", async () => {
    mocks.get.mockImplementation(respuestaGet);
    expect(await siguienteNumero()).toBe("001-001-000000889");
  });

  it("arranca en 1 cuando no hay facturas todavía", async () => {
    mocks.get.mockResolvedValue({ data: [] });
    expect(await siguienteNumero()).toBe("001-001-000000001");
  });

  it("una cédula va como persona natural; un RUC de sociedad como jurídica", () => {
    const natural = clienteContifico({ identificacion: "0954227641", razonSocial: "Diego Reyes" });
    expect(natural).toMatchObject({ cedula: "0954227641", tipo: "N", razon_social: "Diego Reyes" });
    expect(natural).not.toHaveProperty("ruc");
    expect(clienteContifico({ identificacion: "0993388549001", razonSocial: "Courier Box S.A.S." })).toMatchObject({
      cedula: "0993388549", ruc: "0993388549001", tipo: "J",
    });
    expect(clienteContifico({ identificacion: "0954227641001", razonSocial: "Diego" })).toMatchObject({ tipo: "N", ruc: "0954227641001" });
  });

  /** «Formato de email incorrecto»: un cliente sin correo tumbaba la factura porque iba `email: ""`. */
  it("no manda correo, teléfono ni dirección vacíos, y limpia el correo que sí va", () => {
    const sin = clienteContifico({ identificacion: "0954227641", razonSocial: "Diego", email: "", telefono: "", direccion: "  " });
    expect(sin).not.toHaveProperty("email");
    expect(sin).not.toHaveProperty("telefonos");
    expect(sin).not.toHaveProperty("direccion");

    const con = clienteContifico({ identificacion: "0954227641", razonSocial: "Diego", email: "  Diego@Correo.COM ", telefono: "099-525 4965", direccion: "Gye" });
    expect(con).toMatchObject({ email: "diego@correo.com", telefonos: "0995254965", direccion: "Gye" });

    const malo = clienteContifico({ identificacion: "0954227641", razonSocial: "Diego", email: "sin arroba" });
    expect(malo).not.toHaveProperty("email");
    expect(emailParaContifico("a@b")).toBeUndefined();
    expect(emailParaContifico("a@b.co")).toBe("a@b.co");
  });

  it("consumidor final usa la persona 9999999999 que ya existe en la cuenta", () => {
    expect(clienteContifico({ identificacion: "9999999999999", razonSocial: "x" })).toMatchObject({
      cedula: "9999999999", ruc: "9999999999999", razon_social: "Consumidor Final", tipo: "N",
    });
  });

  it("reparte las bases: el flete grava IVA, el arancel no es objeto de IVA", () => {
    const t = armarDetalles([
      { codigoProducto: "CATB01", productoId: "a", cantidad: 10, precio: 6.5, porcentajeIva: 15 },
      { codigoProducto: "REEMB", productoId: "b", cantidad: 10, precio: 1.99, porcentajeIva: 0 },
    ]);
    expect(t.subtotal_12).toBe(65);
    expect(t.subtotal_0).toBe(19.9);
    expect(t.iva).toBe(9.75);
    expect(t.total).toBe(94.65);
    expect(t.detalles[0]).toMatchObject({ producto_id: "a", base_gravable: 65, base_cero: 0, base_no_gravable: 0, porcentaje_iva: 15 });
    // Contifico rechazó «falta campo: porcentaje_iva» cuando iba nulo: el arancel va como 0 %.
    expect(t.detalles[1]).toMatchObject({ producto_id: "b", base_gravable: 0, base_cero: 19.9, base_no_gravable: 0, porcentaje_iva: 0 });
  });

  it("la fecha va como DD/MM/YYYY del día en Ecuador", () => {
    // 03:30 UTC del 8 de septiembre todavía es 7 de septiembre en Guayaquil.
    expect(fechaContifico(new Date("2026-09-08T03:30:00Z"))).toBe("07/09/2026");
  });

  it("traduce los estados que devuelve Contifico", () => {
    expect(mapearEstadoSri("Autorizado")).toBe("autorizado");
    expect(mapearEstadoSri("Enviado SRI")).toBe("enviado");
    expect(mapearEstadoSri("Firmado")).toBe("firmado");
    expect(mapearEstadoSri("No Firmado")).toBe("sin_enviar");
    expect(mapearEstadoSri("Rechazado")).toBe("rechazado");
    expect(mapearEstadoSri("No Autorizado")).toBe("rechazado");
  });
});

describe("contifico — emitirFactura", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    limpiarCacheProductos();
    mocks.get.mockImplementation(respuestaGet);
    mocks.post.mockResolvedValue({ data: { id: "nuevo123", documento: "001-001-000000889" } });
    mocks.put.mockResolvedValue({ data: {} });
  });

  const input = {
    cliente: { identificacion: "0954227641", razonSocial: "Diego Reyes", email: "d@x.com", telefono: "0995254965", direccion: "Guayaquil" },
    lineas: [
      { codigoProducto: "CATB01", cantidad: 10, precio: 6.5, porcentajeIva: 15 },
      { codigoProducto: "REEMB", cantidad: 10, precio: 1.99, porcentajeIva: 0 },
    ],
    descripcion: "10.00 lb · 1 paquete",
  };

  it("crea la factura electrónica con el pos, la manda al SRI y devuelve cómo quedó", async () => {
    const r = await emitirFactura(input);

    expect(r.exito).toBe(true);
    if (!r.exito) return;
    expect(r).toMatchObject({
      id: "nuevo123",
      numero: "001-001-000000889",
      estadoSri: "autorizado",
      autorizacion: "0709202601099338854900120010010000008891234567890",
      urlRide: expect.stringContaining(".pdf"),
    });

    const [url, body] = mocks.post.mock.calls[0];
    expect(url).toBe("/documento/");
    expect(body).toMatchObject({
      pos: "token-pos-de-prueba",
      tipo_documento: "FAC",
      documento: "001-001-000000889",
      electronico: true,
      autorizacion: "",
      cliente: { cedula: "0954227641", tipo: "N", email: "d@x.com" },
      subtotal_12: 65,
      subtotal_0: 19.9,
      iva: 9.75,
      total: 94.65,
    });
    expect(body.detalles.map((d: any) => d.producto_id)).toEqual(["ZxgepMDg5iYgDa1p", "MEegJ9l7BTMvkdQ5"]);
    expect(mocks.put).toHaveBeenCalledWith("/documento/nuevo123/sri/", undefined, expect.anything());
  });

  it("si el número ya existe (alguien facturó a mano entre medio), reintenta con el siguiente", async () => {
    mocks.post
      .mockRejectedValueOnce({ response: { status: 400, data: { mensaje: "El documento 001-001-000000889 ya existe" } } })
      .mockResolvedValueOnce({ data: { id: "nuevo123", documento: "001-001-000000890" } });

    const r = await emitirFactura(input);

    expect(r.exito).toBe(true);
    expect(mocks.post.mock.calls[1][1].documento).toBe("001-001-000000890");
  });

  it("si Contifico rechaza el documento, devuelve su mensaje sin inventar un número", async () => {
    mocks.post.mockRejectedValue({ response: { status: 400, data: { cliente: ["cedula inválida"] } } });

    const r = await emitirFactura(input);

    expect(r.exito).toBe(false);
    if (r.exito) return;
    expect(r.error).toContain("cedula inválida");
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("si el producto no existe en el catálogo, lo dice con nombre y apellido", async () => {
    mocks.get.mockImplementation(async (url: string, config?: any) => (url === "/producto/" ? { data: [] } : respuestaGet(url, config)));

    const r = await emitirFactura(input);

    expect(r.exito).toBe(false);
    if (r.exito) return;
    expect(r.error).toContain('"CATB01" no existe');
  });

  it("si el envío al SRI falla, la factura queda creada y se reporta el estado real", async () => {
    mocks.put.mockRejectedValue({ response: { status: 500, data: "SRI caído" } });
    mocks.get.mockImplementation(async (url: string, config?: any) =>
      /estado\/$/.test(url) ? { data: { estado: "No Firmado" } } : respuestaGet(url, config)
    );

    const r = await emitirFactura(input);

    expect(r.exito).toBe(true);
    if (!r.exito) return;
    expect(r.estadoSri).toBe("sin_enviar");
  });

  it("registra el cobro con el formato de fecha y monto de Contifico", async () => {
    const r = await registrarCobro("nuevo123", { forma: "TRA", monto: 94.65, comprobante: "TRANSF 123", fecha: new Date("2026-09-07T20:00:00Z") });

    expect(r.ok).toBe(true);
    expect(mocks.post).toHaveBeenCalledWith(
      "/documento/nuevo123/cobro/",
      { forma_cobro: "TRA", monto: "94.65", fecha: "07/09/2026", numero_comprobante: "TRANSF 123" },
      expect.anything()
    );
  });
});

describe("contifico — diagnóstico", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    limpiarCacheProductos();
  });

  it("reporta credenciales, siguiente número y los productos resueltos sin crear nada", async () => {
    mocks.get.mockImplementation(respuestaGet);

    const d = await diagnostico();

    expect(d).toMatchObject({
      configurado: true,
      puntoEmision: "001-001",
      siguienteNumero: "001-001-000000889",
      productos: [
        { rol: "flete", codigo: "CATB01", id: "ZxgepMDg5iYgDa1p" },
        { rol: "arancel", codigo: "REEMB", id: "MEegJ9l7BTMvkdQ5" },
      ],
    });
    expect(d.error).toBeUndefined();
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("si un producto no existe, lo dice sin tumbar el resto del diagnóstico", async () => {
    mocks.get.mockImplementation(async (url: string, config?: any) =>
      url === "/producto/" && config?.params?.codigo === "REEMB" ? { data: [] } : respuestaGet(url, config)
    );

    const d = await diagnostico();

    expect(d.productos[0].id).toBe("ZxgepMDg5iYgDa1p");
    expect(d.productos[1]).toMatchObject({ id: null, error: expect.stringContaining('"REEMB" no existe') });
  });
});
