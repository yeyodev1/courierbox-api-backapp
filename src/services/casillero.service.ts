import { models } from "../models/index";

/**
 * El casillero es la clave única de un cliente máster, pero ni el formulario de
 * venta ni un manifiesto de carga lo traen. Genera un código libre de colisión
 * para poder registrar al cliente en el momento y corregir el código después.
 *
 * Vivía dentro de ventas_producto.controller; el ingreso de carga lo necesita
 * igual, así que ahora lo comparten.
 */
export async function generarCasillero(): Promise<string> {
  for (let i = 0; i < 12; i++) {
    const code = `CBX${Math.floor(100000 + Math.random() * 900000)}`;
    const taken = await models.masterClientes.exists({ codigoCasillero: code });
    if (!taken) return code;
  }
  return `CBX${Date.now().toString(36).toUpperCase()}`;
}
