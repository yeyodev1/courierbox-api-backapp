import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.middleware";
import {
  cronRecordatorios,
  deleteAbono,
  deleteCuenta,
  getAjustes,
  getAlertas,
  getPlataforma,
  getCuentas,
  postAbono,
  postCuenta,
  postEnviarResumen,
  putAjustes,
  putAlertas,
  putCuenta,
} from "../controllers/cuentas_cobrar.controller";

export const cuentasCobrarRouter = Router();
// Cuentas por cobrar general: solo gerencia (Oscar y su asistente), desde el módulo de gerencia.
const gestion = [requireAuth, requireRole(["superadmin", "gerencia"])];

// La tarea diaria entra con CRON_SECRET, no con sesión: va antes de las rutas con :id.
cuentasCobrarRouter.get("/cron/recordatorios", cronRecordatorios);

cuentasCobrarRouter.get("/ajustes", ...gestion, getAjustes);
cuentasCobrarRouter.put("/ajustes", ...gestion, putAjustes);
cuentasCobrarRouter.get("/plataforma", ...gestion, getPlataforma);
cuentasCobrarRouter.get("/alertas", ...gestion, getAlertas);
cuentasCobrarRouter.put("/alertas", ...gestion, putAlertas);
cuentasCobrarRouter.post("/alertas/enviar", ...gestion, postEnviarResumen);

cuentasCobrarRouter.get("/", ...gestion, getCuentas);
cuentasCobrarRouter.post("/", ...gestion, postCuenta);
cuentasCobrarRouter.put("/:id", ...gestion, putCuenta);
cuentasCobrarRouter.delete("/:id", ...gestion, deleteCuenta);
cuentasCobrarRouter.post("/:id/abonos", ...gestion, postAbono);
cuentasCobrarRouter.delete("/:id/abonos/:abonoId", ...gestion, deleteAbono);
