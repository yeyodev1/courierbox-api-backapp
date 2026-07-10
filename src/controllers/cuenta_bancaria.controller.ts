import type { Request, Response, NextFunction } from "express";
import * as CuentaService from "../services/cuenta_bancaria.service.js";

// GET /api/v1/cuentas-bancarias?soloActivas=true
export async function listCuentas(req: Request, res: Response, next: NextFunction) {
  try {
    const soloActivas = String(req.query.soloActivas ?? "true") !== "false";
    const cuentas = await CuentaService.listCuentas(soloActivas);
    res.json({ cuentas });
  } catch (err) {
    next(err);
  }
}

// POST /api/v1/cuentas-bancarias
export async function createCuenta(req: Request, res: Response, next: NextFunction) {
  try {
    const banco = String(req.body.banco ?? "");
    const numeroCuenta = String(req.body.numeroCuenta ?? "");
    const titular = String(req.body.titular ?? "");
    const tipoCuenta = req.body.tipoCuenta as "corriente" | "ahorros" | undefined;
    if (!banco || !numeroCuenta || !titular) {
      return res.status(400).json({ error: "banco, numeroCuenta y titular son requeridos" });
    }
    const cuenta = await CuentaService.createCuenta({ banco, numeroCuenta, titular, tipoCuenta });
    res.status(201).json({ cuenta });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/v1/cuentas-bancarias/:id
export async function updateCuenta(req: Request, res: Response, next: NextFunction) {
  try {
    const cuenta = await CuentaService.updateCuenta(String(req.params.id), req.body);
    if (!cuenta) return res.status(404).json({ error: "Cuenta no encontrada" });
    res.json({ cuenta });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/v1/cuentas-bancarias/:id (soft delete)
export async function deleteCuenta(req: Request, res: Response, next: NextFunction) {
  try {
    const cuenta = await CuentaService.deleteCuenta(String(req.params.id));
    if (!cuenta) return res.status(404).json({ error: "Cuenta no encontrada" });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}
