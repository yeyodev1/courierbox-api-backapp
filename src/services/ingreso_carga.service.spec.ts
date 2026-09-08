import { readFileSync } from "node:fs";
import { join } from "node:path";
import mongoose from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clientesFind: vi.fn(),
  clientesCreate: vi.fn(),
  clientesExists: vi.fn(),
  aliasesFind: vi.fn(),
  aliasesFindOne: vi.fn(),
  aliasesCreate: vi.fn(),
  paquetesFindOne: vi.fn(),
  paquetesCreate: vi.fn(),
  paquetesUpdateOne: vi.fn(),
}));

vi.mock("../models/index", () => ({
  models: {
    masterClientes: { find: mocks.clientesFind, create: mocks.clientesCreate, exists: mocks.clientesExists },
    clienteAliases: { find: mocks.aliasesFind, findOne: mocks.aliasesFindOne, create: mocks.aliasesCreate },
    paquetes: { findOne: mocks.paquetesFindOne, create: mocks.paquetesCreate, updateOne: mocks.paquetesUpdateOne },
  },
}));

import {
  claveNombre,
  filasDesdeManual,
  procesarIngresoManual,
  leerIngresoCarga,
  nombreOficialDesde,
  parsearFecha,
  parsearPeso,
  parsearWr,
  procesarIngresoCarga,
} from "./ingreso_carga.service";

/** El archivo tal cual lo mandó el cliente, sin retocar. */
const ARCHIVO = readFileSync(join(__dirname, "../test/fixtures/ingreso_de_carga.xlsx"));

function lean<T>(value: T) {
  return { lean: vi.fn().mockResolvedValue(value), select: vi.fn().mockReturnThis() };
}

function conClientes(clientes: Array<{ _id?: string; nombreOficial: string; codigoCasillero?: string }>, aliases: Array<{ masterId: string; variacion: string }> = []) {
  mocks.clientesFind.mockReturnValue(
    lean(clientes.map((c) => ({ _id: c._id ?? new mongoose.Types.ObjectId().toString(), codigoCasillero: c.codigoCasillero ?? "CBX000001", ...c })))
  );
  mocks.aliasesFind.mockReturnValue(lean(aliases));
}

function sinPaquetesPrevios() {
  mocks.paquetesFindOne.mockReturnValue(lean(null));
}

describe("lectura de la hoja de Ingreso de carga", () => {
  it("lee el archivo real por nombre de columna, no por posición", () => {
    const { filas, errores } = leerIngresoCarga(ARCHIVO);

    expect(errores).toEqual([]);
    expect(filas).toHaveLength(15);
    expect(filas[0]).toMatchObject({
      fila: 2,
      wr: "WR839943",
      mg: "MG002516",
      clienteRaw: "MARIA ELIZABETH GILER",
      agencia: "COURIER BOX",
      origen: "FLORIDA",
      pesoLb: 8,
      reempaque: true,
    });
    expect(filas[0].fechaIngreso?.toISOString().slice(0, 10)).toBe("2026-08-25");
  });

  it('separa "WR846668 DIVIDIDO" en el WR y su nota', () => {
    expect(parsearWr("WR846668 DIVIDIDO")).toEqual({ wr: "WR846668", nota: "DIVIDIDO" });
    expect(parsearWr("wr 874096")).toEqual({ wr: "WR874096", nota: "" });
    expect(parsearWr("sin nada")).toEqual({ wr: "", nota: "sin nada" });
  });

  it("entiende pesos escritos como texto con espacios y comas", () => {
    expect(parsearPeso("1.5 ")).toBe(1.5);
    expect(parsearPeso("0,25")).toBe(0.25);
    expect(parsearPeso(8)).toBe(8);
    expect(parsearPeso("")).toBe(0);
  });

  it("guarda la fecha MM/DD/YYYY como el día que nombra, en UTC", () => {
    expect(parsearFecha("08/25/2026")?.toISOString()).toBe("2026-08-25T00:00:00.000Z");
    expect(parsearFecha(new Date(2026, 7, 28, 19, 0))?.toISOString()).toBe("2026-08-28T00:00:00.000Z");
    expect(parsearFecha("no es fecha")).toBeNull();
  });

  it("rechaza con un mensaje claro un archivo que no es el de carga", () => {
    const XLSX = require("xlsx");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Nombre", "Monto"], ["A", 1]]), "Hoja1");
    const buffer: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    expect(() => leerIngresoCarga(buffer)).toThrow(/BOX ID/);
  });
});

describe("clave de comparación de nombres", () => {
  it("ignora mayúsculas, tildes, espacios dobles y la marca MP", () => {
    expect(claveNombre("  NORMA BANO MP")).toBe("NORMA BANO");
    expect(claveNombre("norma  baño")).toBe("NORMA BANO");
    expect(claveNombre("LALLEZKA ZAVALA *WR DIVIDIDO")).toBe("LALLEZKA ZAVALA");
  });

  it("registra al cliente nuevo con el nombre limpio", () => {
    expect(nombreOficialDesde(" DANIELA ABIGAIL ZAMBRANO LOPEZ MP")).toBe("DANIELA ABIGAIL ZAMBRANO LOPEZ");
  });
});

describe("procesarIngresoCarga — previsualizar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sinPaquetesPrevios();
  });

  it("no escribe nada y dice qué clientes se van a crear", async () => {
    conClientes([{ _id: "a".repeat(24), nombreOficial: "Andrea Maldonado", codigoCasillero: "CBX111111" }]);

    const r = await procesarIngresoCarga(ARCHIVO, { aplicar: false });

    expect(r.aplicado).toBe(false);
    expect(r.totalFilas).toBe(15);
    expect(mocks.clientesCreate).not.toHaveBeenCalled();
    expect(mocks.paquetesCreate).not.toHaveBeenCalled();
    expect(mocks.paquetesUpdateOne).not.toHaveBeenCalled();
    expect(mocks.aliasesCreate).not.toHaveBeenCalled();

    const andrea = r.filas.find((f) => f.wr === "WR874096");
    expect(andrea).toMatchObject({ accion: "existente", casillero: "CBX111111", clienteNombreOficial: "Andrea Maldonado" });

    const nueva = r.filas.find((f) => f.wr === "WR839943");
    expect(nueva).toMatchObject({ accion: "creado", casillero: "(se asignará)", clienteNombreOficial: "MARIA ELIZABETH GILER" });
  });

  it("un nombre repetido en el archivo cuenta como un solo cliente nuevo", async () => {
    conClientes([]);

    const r = await procesarIngresoCarga(ARCHIVO, { aplicar: false });

    // MARTIN QUINDE aparece dos veces (WR875012 y WR875090).
    const quinde = r.filas.filter((f) => f.cliente === "MARTIN QUINDE");
    expect(quinde).toHaveLength(2);
    expect(quinde.every((f) => f.accion === "creado")).toBe(true);
    // 15 filas, 14 nombres distintos.
    expect(r.clientesCreados).toBe(14);
  });

  it("reconoce un parecido alto y lo marca como aproximado, con quién y cuánto", async () => {
    conClientes([{ _id: "b".repeat(24), nombreOficial: "MARIA ELIZABETH GILLER", codigoCasillero: "CBX222222" }]);

    const r = await procesarIngresoCarga(ARCHIVO, { aplicar: false });
    const fila = r.filas.find((f) => f.wr === "WR839943")!;

    expect(fila.accion).toBe("aproximado");
    expect(fila.coincideCon).toBe("MARIA ELIZABETH GILLER");
    expect(fila.score).toBeGreaterThanOrEqual(0.85);
    expect(r.aproximados).toBe(1);
  });

  it("empareja por alias ya resuelto antes de intentar parecidos", async () => {
    const id = "c".repeat(24);
    conClientes([{ _id: id, nombreOficial: "Yamila Plúa Cedeño", codigoCasillero: "CBX333333" }], [{ masterId: id, variacion: "YAMILA PLUA" }]);

    const r = await procesarIngresoCarga(ARCHIVO, { aplicar: false });
    const fila = r.filas.find((f) => f.wr === "WR874259")!;

    expect(fila.accion).toBe("alias");
    expect(fila.casillero).toBe("CBX333333");
  });
});

describe("procesarIngresoCarga — aplicar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sinPaquetesPrevios();
    mocks.clientesExists.mockResolvedValue(null);
    mocks.aliasesFindOne.mockResolvedValue(null);
    mocks.clientesCreate.mockImplementation(async (doc: any) => ({ _id: new mongoose.Types.ObjectId(), ...doc }));
    mocks.paquetesCreate.mockResolvedValue({});
    mocks.paquetesUpdateOne.mockResolvedValue({});
  });

  it("crea el cliente que no existe, con casillero, y le cuelga el paquete", async () => {
    conClientes([]);

    const r = await procesarIngresoCarga(ARCHIVO, { aplicar: true, origenNota: "INGRESO DE CARGA.xlsx" });

    expect(r.aplicado).toBe(true);
    expect(r.clientesCreados).toBe(14);
    expect(mocks.clientesCreate).toHaveBeenCalledTimes(14);
    expect(mocks.clientesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        nombreOficial: "MARIA ELIZABETH GILER",
        codigoCasillero: expect.stringMatching(/^CBX\d{6}$/),
        subagencyId: "COURIER BOX",
        notas: expect.stringContaining("INGRESO DE CARGA.xlsx"),
      })
    );

    expect(r.paquetesNuevos).toBe(15);
    expect(mocks.paquetesCreate).toHaveBeenCalledTimes(15);
    const primero = mocks.paquetesCreate.mock.calls.find((c) => c[0].wr === "WR839943")![0];
    expect(primero).toMatchObject({
      mg: "MG002516",
      pesoLb: 8,
      contenido: expect.stringContaining("5 suplementos"),
      agencia: "COURIER BOX",
      estado: "importado",
      reempaque: true,
    });
    expect(primero.masterClienteId).toBeInstanceOf(mongoose.Types.ObjectId);
    expect(primero.fechaIngreso.toISOString().slice(0, 10)).toBe("2026-08-25");
  });

  it("dos cajas del mismo cliente nuevo van al mismo cliente", async () => {
    conClientes([]);

    await procesarIngresoCarga(ARCHIVO, { aplicar: true });

    const quinde = mocks.paquetesCreate.mock.calls.map((c) => c[0]).filter((d) => d.consigneeNombre === "MARTIN QUINDE");
    expect(quinde).toHaveLength(2);
    expect(String(quinde[0].masterClienteId)).toBe(String(quinde[1].masterClienteId));
  });

  it("recuerda la grafía del manifiesto como alias cuando difiere del nombre oficial", async () => {
    conClientes([]);

    await procesarIngresoCarga(ARCHIVO, { aplicar: true });

    // "NORMA BANO MP" se registra como "NORMA BANO"; la grafía con MP queda de alias.
    expect(mocks.aliasesCreate).toHaveBeenCalledWith(expect.objectContaining({ variacion: "NORMA BANO MP" }));
    // "MARTIN QUINDE" ya es el nombre oficial: no necesita alias.
    expect(mocks.aliasesCreate).not.toHaveBeenCalledWith(expect.objectContaining({ variacion: "MARTIN QUINDE" }));
  });

  it("volver a subir el mismo archivo actualiza el paquete en vez de duplicarlo", async () => {
    conClientes([]);
    mocks.paquetesFindOne.mockImplementation(() => lean({ _id: new mongoose.Types.ObjectId(), estado: "importado" }));

    const r = await procesarIngresoCarga(ARCHIVO, { aplicar: true });

    expect(r.paquetesNuevos).toBe(0);
    expect(r.paquetesActualizados).toBe(15);
    expect(mocks.paquetesCreate).not.toHaveBeenCalled();
    expect(mocks.paquetesUpdateOne).toHaveBeenCalledTimes(15);
  });

  it("no toca un paquete que ya está facturado", async () => {
    conClientes([]);
    mocks.paquetesFindOne.mockImplementation(() => lean({ _id: new mongoose.Types.ObjectId(), estado: "facturado" }));

    const r = await procesarIngresoCarga(ARCHIVO, { aplicar: true });

    expect(r.omitidos).toBe(15);
    expect(mocks.paquetesUpdateOne).not.toHaveBeenCalled();
    expect(r.filas[0]).toMatchObject({ accion: "omitido", detalle: expect.stringContaining("facturado") });
  });

  it("una fila sin cliente entra igual, pendiente de homologar, y no crea nada", async () => {
    const XLSX = require("xlsx");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["Date", "Master", "BOX ID", "CLIENTE", "Peso"],
        ["08/25/2026", "MG1", "WR100", "", "2"],
      ]),
      "Hoja1"
    );
    const buffer: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    conClientes([]);

    const r = await procesarIngresoCarga(buffer, { aplicar: true });

    expect(r.sinCliente).toBe(1);
    expect(mocks.clientesCreate).not.toHaveBeenCalled();
    expect(mocks.paquetesCreate).toHaveBeenCalledWith(expect.objectContaining({ wr: "WR100", masterClienteId: null, estado: "pendiente_validacion" }));
  });
});

describe("procesarIngresoCarga — vincular a mano", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sinPaquetesPrevios();
    mocks.clientesExists.mockResolvedValue(null);
    mocks.aliasesFindOne.mockResolvedValue(null);
    mocks.clientesCreate.mockImplementation(async (doc: any) => ({ _id: new mongoose.Types.ObjectId(), ...doc }));
    mocks.paquetesCreate.mockResolvedValue({});
  });

  it("ofrece parecidos por debajo del umbral para que el operador elija", async () => {
    // "MARIA ELIZABETH GILER" vs "MARIA ELIZABETH GILER TORRES": parecido, pero no como para decidir solo.
    conClientes([{ _id: "d".repeat(24), nombreOficial: "MARIA ELIZABETH GILER TORRES", codigoCasillero: "CBX444444" }]);

    const r = await procesarIngresoCarga(ARCHIVO, { aplicar: false });
    const fila = r.filas.find((f) => f.wr === "WR839943")!;

    expect(fila.accion).toBe("creado");
    expect(fila.sugerencias?.[0]).toMatchObject({ masterId: "d".repeat(24), nombreOficial: "MARIA ELIZABETH GILER TORRES", casillero: "CBX444444" });
    expect(fila.sugerencias?.[0].score).toBeGreaterThanOrEqual(0.55);
    expect(fila.sugerencias?.[0].score).toBeLessThan(0.85);
  });

  it("una decisión de vincular manda sobre el emparejamiento y cuelga la caja a ese cliente", async () => {
    const id = "d".repeat(24);
    conClientes([{ _id: id, nombreOficial: "MARIA ELIZABETH GILER TORRES", codigoCasillero: "CBX444444" }]);

    const r = await procesarIngresoCarga(ARCHIVO, { aplicar: true, decisiones: { WR839943: { masterClienteId: id } } });
    const fila = r.filas.find((f) => f.wr === "WR839943")!;

    expect(fila).toMatchObject({ accion: "vinculado", casillero: "CBX444444", clienteNombreOficial: "MARIA ELIZABETH GILER TORRES" });
    expect(r.vinculados).toBe(1);
    const paquete = mocks.paquetesCreate.mock.calls.find((c) => c[0].wr === "WR839943")![0];
    expect(String(paquete.masterClienteId)).toBe(id);
    // No se creó un cliente para esa fila.
    expect(mocks.clientesCreate).not.toHaveBeenCalledWith(expect.objectContaining({ nombreOficial: "MARIA ELIZABETH GILER" }));
    // La grafía del manifiesto queda como alias del cliente elegido.
    expect(mocks.aliasesCreate).toHaveBeenCalledWith(expect.objectContaining({ masterId: new mongoose.Types.ObjectId(id), variacion: "MARIA ELIZABETH GILER" }));
  });

  it("una decisión de crear nuevo evita que un parecido alto se vincule solo", async () => {
    conClientes([{ _id: "b".repeat(24), nombreOficial: "MARIA ELIZABETH GILLER", codigoCasillero: "CBX222222" }]);

    const r = await procesarIngresoCarga(ARCHIVO, { aplicar: true, decisiones: { WR839943: { crearNuevo: true } } });
    const fila = r.filas.find((f) => f.wr === "WR839943")!;

    expect(fila.accion).toBe("creado");
    expect(mocks.clientesCreate).toHaveBeenCalledWith(expect.objectContaining({ nombreOficial: "MARIA ELIZABETH GILER" }));
  });

  it("si el cliente elegido ya no existe, la fila queda en error y no se inventa nada", async () => {
    conClientes([]);

    const r = await procesarIngresoCarga(ARCHIVO, { aplicar: true, decisiones: { WR839943: { masterClienteId: "e".repeat(24) } } });
    const fila = r.filas.find((f) => f.wr === "WR839943")!;

    expect(fila.accion).toBe("error");
    expect(fila.detalle).toContain("ya no existe");
    expect(mocks.paquetesCreate).not.toHaveBeenCalledWith(expect.objectContaining({ wr: "WR839943" }));
  });
});

describe("ingreso manual, caja por caja", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sinPaquetesPrevios();
    mocks.clientesExists.mockResolvedValue(null);
    mocks.aliasesFindOne.mockResolvedValue(null);
    mocks.clientesCreate.mockImplementation(async (doc: any) => ({ _id: new mongoose.Types.ObjectId(), ...doc }));
    mocks.paquetesCreate.mockResolvedValue({});
  });

  it("exige el formato del manifiesto: WR, MG, peso y fecha", () => {
    const { filas, errores } = filasDesdeManual([
      { wr: "839943", cliente: "X", peso: 1 },
      { wr: "WR1", mg: "2516", cliente: "X", peso: 1 },
      { wr: "WR2", cliente: "X", peso: 0 },
      { wr: "WR3", cliente: "X", peso: 2, fecha: "no" },
      { wr: "wr 4", mg: "mg002516", cliente: "  Norma  Bano MP ", peso: "1,5", fecha: "2026-08-25", reempaque: "si", tracking: "_tba1_" },
    ]);
    expect(errores).toHaveLength(4);
    expect(errores[0]).toContain("WR seguido de números");
    expect(errores[1]).toContain("MG seguido de números");
    expect(errores[2]).toContain("mayor que 0");
    expect(errores[3]).toContain("fecha no es válida");
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ wr: "WR4", mg: "MG002516", clienteRaw: "Norma Bano MP", pesoLb: 1.5, reempaque: true, tracking: "tba1" });
    expect(filas[0].fechaIngreso?.toISOString().slice(0, 10)).toBe("2026-08-25");
  });

  it("pasa por el mismo motor que el Excel: previsualiza sin escribir y aplica creando el cliente", async () => {
    conClientes([]);
    const prev = await procesarIngresoManual([{ wr: "WR900", cliente: "ANA PRUEBA", peso: 2, contenido: "zapatos" }], { aplicar: false });
    expect(prev.filas[0]).toMatchObject({ wr: "WR900", accion: "creado", clienteNombreOficial: "ANA PRUEBA", paquete: "nuevo" });
    expect(mocks.clientesCreate).not.toHaveBeenCalled();

    const r = await procesarIngresoManual([{ wr: "WR900", cliente: "ANA PRUEBA", peso: 2, contenido: "zapatos" }], { aplicar: true });
    expect(r.clientesCreados).toBe(1);
    expect(mocks.paquetesCreate).toHaveBeenCalledWith(expect.objectContaining({ wr: "WR900", contenido: "zapatos", pesoLb: 2, estado: "importado" }));
  });
});
