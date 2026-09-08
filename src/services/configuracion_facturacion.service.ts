import { models } from "../models/index";

/**
 * El IVA que grava el flete. En Ecuador cambió de 12 a 15 % en 2024 y el
 * gobierno lo mueve; que el counter pueda cambiarlo sin un despliegue. Se
 * guarda una sola vez para toda la empresa y lo usan tanto los totales en
 * pantalla como la factura que se manda a Contifico.
 */
export const IVA_PORCENTAJES_PERMITIDOS = [0, 5, 8, 12, 15] as const;
export const IVA_PORCENTAJE_DEFECTO = 15;
const CLAVE_IVA = "facturacion.ivaPorcentaje";

let cache: { valor: number; leidoEn: number } | null = null;
const CACHE_MS = 30_000;

export function esIvaPermitido(valor: unknown): valor is (typeof IVA_PORCENTAJES_PERMITIDOS)[number] {
  return IVA_PORCENTAJES_PERMITIDOS.includes(Number(valor) as never);
}

export async function obtenerIvaPorcentaje(): Promise<number> {
  if (cache && Date.now() - cache.leidoEn < CACHE_MS) return cache.valor;
  const doc = (await models.configuraciones.findOne({ clave: CLAVE_IVA }).lean()) as { valor?: unknown } | null;
  const valor = esIvaPermitido(doc?.valor) ? Number(doc!.valor) : IVA_PORCENTAJE_DEFECTO;
  cache = { valor, leidoEn: Date.now() };
  return valor;
}

export async function guardarIvaPorcentaje(valor: unknown, usuario = ""): Promise<number> {
  if (!esIvaPermitido(valor)) {
    throw Object.assign(new Error(`El IVA debe ser uno de: ${IVA_PORCENTAJES_PERMITIDOS.join(", ")} %`), { status: 400 });
  }
  const numero = Number(valor);
  await models.configuraciones.updateOne(
    { clave: CLAVE_IVA },
    { $set: { valor: numero, actualizadoPor: usuario } },
    { upsert: true }
  );
  cache = { valor: numero, leidoEn: Date.now() };
  return numero;
}

/** Sólo para tests. */
export function limpiarCacheIva() {
  cache = null;
}
