import mongoose from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  paquetesFind: vi.fn(),
  paquetesUpdateMany: vi.fn(),
  clientesFindById: vi.fn(),
  clientesFindOne: vi.fn(),
  clientesFindByIdAndUpdate: vi.fn(),
  clientesFind: vi.fn(),
  facturasCreate: vi.fn(),
  emitirFactura: vi.fn(),
  createAndSendNotification: vi.fn(),
}));

vi.mock("../models/index", () => ({
  models: {
    paquetes: { find: mocks.paquetesFind, updateMany: mocks.paquetesUpdateMany },
    masterClientes: { findById: mocks.clientesFindById, findOne: mocks.clientesFindOne, findByIdAndUpdate: mocks.clientesFindByIdAndUpdate, find: mocks.clientesFind },
    facturas: { create: mocks.facturasCreate },
  },
}));
vi.mock("./contifico.service", () => ({ contificoService: { emitirFactura: mocks.emitirFactura } }));
vi.mock("./ghl-webhook.service", () => ({ enviarWebhookFactura: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./notification.service", () => ({ createAndSendNotification: mocks.createAndSendNotification }));
vi.mock("../config/env", () => ({
  env: { FRONTEND_ORIGIN: ["https://courierboxlogistics.com"], CONTIFICO_PRODUCTO_FLETE: "CATB01", CONTIFICO_PRODUCTO_ARANCEL: "REEMB" },
}));

import {
  cedulaValida,
  completarDatosCliente,
  facturarPaquetes,
  listarFacturables,
  identificacionValida,
  rucValido,
  validarClienteParaFactura,
} from "./facturacion.service";

describe("identificación ecuatoriana", () => {
  it("acepta cédulas reales y rechaza las mal formadas", () => {
    expect(cedulaValida("0954227641")).toBe(true);
    expect(cedulaValida("1710034065")).toBe(true);
    expect(cedulaValida("0954227642")).toBe(false); // dígito verificador
    expect(cedulaValida("2554227641")).toBe(false); // provincia
    expect(cedulaValida("095422764")).toBe(false);
  });

  it("acepta RUC de natural, de sociedad privada y el de consumidor final", () => {
    expect(rucValido("0954227641001")).toBe(true);
    expect(rucValido("0993388549001")).toBe(true); // Courier Box
    expect(rucValido("9999999999999")).toBe(true);
    expect(rucValido("0954227641002")).toBe(false);
    expect(identificacionValida("099338854")).toBe(false);
  });
});

describe("validarClienteParaFactura", () => {
  const base = { nombreOficial: "Diego Reyes", cedulaRuc: "0954227641", email: "d@x.com", telefono: "0995254965", direccion: "Gye" };

  it("un cliente completo está listo", () => {
    expect(validarClienteParaFactura(base, 120)).toEqual({ faltantes: [], consumidorFinalPosible: false, listo: true });
  });

  it("sin cédula no está listo, y por más de $50 ni consumidor final sirve", () => {
    const v = validarClienteParaFactura({ ...base, cedulaRuc: "" }, 120);
    expect(v.listo).toBe(false);
    expect(v.consumidorFinalPosible).toBe(false);
    expect(v.faltantes[0]).toMatchObject({ campo: "cedulaRuc", requerido: true, mensaje: expect.stringContaining("$50") });
  });

  it("sin cédula pero hasta $50 ofrece consumidor final", () => {
    const v = validarClienteParaFactura({ ...base, cedulaRuc: "" }, 42);
    expect(v.consumidorFinalPosible).toBe(true);
    expect(v.faltantes[0].mensaje).toContain("consumidor final");
  });

  it("una cédula mal escrita se marca como requerida, no como vacía", () => {
    const v = validarClienteParaFactura({ ...base, cedulaRuc: "0954227642" }, 10);
    expect(v.faltantes[0]).toMatchObject({ campo: "cedulaRuc", requerido: true, mensaje: expect.stringContaining("no es una cédula") });
  });

  it("correo, teléfono y dirección faltantes avisan pero no bloquean", () => {
    const v = validarClienteParaFactura({ nombreOficial: "X", cedulaRuc: "0954227641" }, 10);
    expect(v.listo).toBe(true);
    expect(v.faltantes.map((f) => f.campo)).toEqual(["email", "telefono", "direccion"]);
    expect(v.faltantes.every((f) => !f.requerido)).toBe(true);
  });
});

function lean<T>(value: T) {
  return { lean: vi.fn().mockResolvedValue(value), select: vi.fn().mockReturnThis(), populate: vi.fn().mockReturnThis() };
}

describe("completarDatosCliente", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rechaza una cédula inválida antes de tocar la base", async () => {
    const r = await completarDatosCliente(new mongoose.Types.ObjectId().toString(), { cedulaRuc: "1234567890" });
    expect(r).toMatchObject({ exito: false, error: expect.stringContaining("no es válido") });
    expect(mocks.clientesFindByIdAndUpdate).not.toHaveBeenCalled();
  });

  it("no deja poner la cédula de otro cliente", async () => {
    mocks.clientesFindOne.mockReturnValue(lean({ nombreOficial: "Otro", codigoCasillero: "CBX1" }));
    const r = await completarDatosCliente(new mongoose.Types.ObjectId().toString(), { cedulaRuc: "0954227641" });
    expect(r).toMatchObject({ exito: false, error: expect.stringContaining("ya pertenece a Otro") });
  });

  it("guarda sólo lo enviado, limpio", async () => {
    mocks.clientesFindOne.mockReturnValue(lean(null));
    const id = new mongoose.Types.ObjectId().toString();
    mocks.clientesFindByIdAndUpdate.mockReturnValue(lean({ _id: id, nombreOficial: "Diego", cedulaRuc: "0954227641", email: "d@x.com", telefono: "", direccion: "", codigoCasillero: "CBX9" }));

    const r = await completarDatosCliente(id, { cedulaRuc: " 095-422-7641 ", email: " d@x.com " });

    expect(mocks.clientesFindByIdAndUpdate).toHaveBeenCalledWith(id, { $set: { cedulaRuc: "0954227641", email: "d@x.com" } }, { new: true });
    expect(r).toMatchObject({ exito: true, cliente: { cedulaRuc: "0954227641" } });
  });
});

describe("facturarPaquetes", () => {
  const clienteId = new mongoose.Types.ObjectId();
  const paquetes = [
    { _id: new mongoose.Types.ObjectId(), wr: "WR1", pesoLb: 10, contenido: "ropa", masterClienteId: clienteId, facturaId: null },
  ];
  const cliente = { _id: clienteId, nombreOficial: "Diego Reyes", cedulaRuc: "0954227641", email: "d@x.com", telefono: "099", direccion: "Gye", codigoCasillero: "CBX9" };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.paquetesFind.mockReturnValue(lean(paquetes));
    mocks.clientesFindById.mockReturnValue(lean(cliente));
    mocks.facturasCreate.mockImplementation(async (doc: any) => ({ _id: new mongoose.Types.ObjectId(), ...doc }));
    mocks.paquetesUpdateMany.mockResolvedValue({});
    mocks.createAndSendNotification.mockResolvedValue({});
  });

  it("emite con las dos líneas por libra y guarda lo que el SRI respondió", async () => {
    mocks.emitirFactura.mockResolvedValue({
      exito: true, id: "ctf1", numero: "001-001-000000889", estadoSri: "autorizado",
      autorizacion: "07092026…", urlRide: "https://x/ride.pdf", urlXml: "https://x/xml/", mensaje: "Autorizado", raw: {},
    });

    const r = await facturarPaquetes([String(paquetes[0]._id)]);

    expect(r.exito).toBe(true);
    if (!r.exito) return;
    expect(r.factura).toMatchObject({ numeroFactura: "001-001-000000889", estadoSri: "autorizado", pdfUrl: "https://x/ride.pdf", totalGeneral: 94.65 });

    const input = mocks.emitirFactura.mock.calls[0][0];
    expect(input.cliente).toMatchObject({ identificacion: "0954227641", razonSocial: "Diego Reyes", direccion: "Gye" });
    expect(input.lineas).toEqual([
      { codigoProducto: "CATB01", cantidad: 10, precio: 6.5, porcentajeIva: 15 },
      { codigoProducto: "REEMB", cantidad: 10, precio: 1.99, porcentajeIva: 0 },
    ]);
    expect(mocks.facturasCreate).toHaveBeenCalledWith(expect.objectContaining({ contificoId: "ctf1", autorizacionSri: "07092026…", xmlUrl: "https://x/xml/" }));
    expect(mocks.paquetesUpdateMany).toHaveBeenCalledWith({ _id: { $in: [String(paquetes[0]._id)] } }, { $set: expect.objectContaining({ estado: "facturado" }) });
  });

  /** Antes se guardaba una factura TEMP-… y los paquetes quedaban "facturados" aunque Contifico fallara. */
  it("si Contifico rechaza, no guarda factura ni marca paquetes", async () => {
    mocks.emitirFactura.mockResolvedValue({ exito: false, error: "cedula inválida" });

    const r = await facturarPaquetes([String(paquetes[0]._id)]);

    expect(r).toMatchObject({ exito: false, error: expect.stringContaining("cedula inválida") });
    expect(mocks.facturasCreate).not.toHaveBeenCalled();
    expect(mocks.paquetesUpdateMany).not.toHaveBeenCalled();
  });

  it("sin cédula devuelve los faltantes en vez de mandar una factura que el SRI rechazaría", async () => {
    mocks.clientesFindById.mockReturnValue(lean({ ...cliente, cedulaRuc: "" }));

    const r = await facturarPaquetes([String(paquetes[0]._id)]);

    expect(r.exito).toBe(false);
    if (r.exito) return;
    expect(r.faltantes?.[0]).toMatchObject({ campo: "cedulaRuc", requerido: true });
    expect(mocks.emitirFactura).not.toHaveBeenCalled();
  });

  it("consumidor final sólo hasta $50: con 10 lb ($94.65) lo rechaza", async () => {
    mocks.clientesFindById.mockReturnValue(lean({ ...cliente, cedulaRuc: "" }));

    const r = await facturarPaquetes([String(paquetes[0]._id)], { consumidorFinal: true });

    expect(r).toMatchObject({ exito: false, error: expect.stringContaining("$50") });
    expect(mocks.emitirFactura).not.toHaveBeenCalled();
  });

  it("consumidor final con un total chico factura al 9999999999999", async () => {
    mocks.paquetesFind.mockReturnValue(lean([{ ...paquetes[0], pesoLb: 2 }]));
    mocks.clientesFindById.mockReturnValue(lean({ ...cliente, cedulaRuc: "" }));
    mocks.emitirFactura.mockResolvedValue({ exito: true, id: "c", numero: "001-001-000000890", estadoSri: "enviado", autorizacion: "", urlRide: "", urlXml: "", mensaje: "Enviado SRI", raw: {} });

    const r = await facturarPaquetes([String(paquetes[0]._id)], { consumidorFinal: true });

    expect(r.exito).toBe(true);
    expect(mocks.emitirFactura.mock.calls[0][0].cliente.identificacion).toBe("9999999999999");
  });

  it("no factura dos veces un paquete que ya tiene factura", async () => {
    mocks.paquetesFind.mockReturnValue(lean([{ ...paquetes[0], facturaId: new mongoose.Types.ObjectId() }]));

    const r = await facturarPaquetes([String(paquetes[0]._id)]);

    expect(r).toMatchObject({ exito: false, error: expect.stringContaining("ya tiene factura") });
  });
});

describe("listarFacturables", () => {
  beforeEach(() => vi.clearAllMocks());

  it("también encuentra las cajas de un cliente buscando por su casillero", async () => {
    const clienteId = new mongoose.Types.ObjectId();
    mocks.clientesFind.mockReturnValue({ select: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), lean: vi.fn().mockResolvedValue([{ _id: clienteId }]) });
    const query = { populate: vi.fn().mockReturnThis(), sort: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), lean: vi.fn().mockResolvedValue([]) };
    mocks.paquetesFind.mockReturnValue(query);

    await listarFacturables("CBX640302");

    const filtro = mocks.paquetesFind.mock.calls[0][0];
    expect(filtro.$or).toContainEqual({ masterClienteId: { $in: [clienteId] } });
    expect(mocks.clientesFind).toHaveBeenCalledWith({ $or: [{ codigoCasillero: expect.any(RegExp) }, { nombreOficial: expect.any(RegExp) }] });
  });
});
