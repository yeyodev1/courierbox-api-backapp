import { models } from "../models/index.js";

export interface CreateCuentaBancariaInput {
  banco: string;
  numeroCuenta: string;
  titular: string;
  tipoCuenta?: "corriente" | "ahorros";
}

export async function listCuentas(soloActivas = false) {
  const filter = soloActivas ? { activa: true } : {};
  return models.cuentasBancarias.find(filter).sort({ banco: 1 }).lean();
}

export async function createCuenta(input: CreateCuentaBancariaInput) {
  return models.cuentasBancarias.create({
    banco: input.banco.trim(),
    numeroCuenta: input.numeroCuenta.trim(),
    titular: input.titular.trim(),
    tipoCuenta: input.tipoCuenta ?? "corriente",
    activa: true,
  });
}

export async function updateCuenta(
  id: string,
  data: Partial<{
    banco: string;
    numeroCuenta: string;
    titular: string;
    tipoCuenta: "corriente" | "ahorros";
    activa: boolean;
  }>
) {
  return models.cuentasBancarias.findByIdAndUpdate(id, { $set: data }, { new: true }).lean();
}

export async function deleteCuenta(id: string) {
  return models.cuentasBancarias.findByIdAndUpdate(
    id,
    { $set: { activa: false } },
    { new: true }
  ).lean();
}
