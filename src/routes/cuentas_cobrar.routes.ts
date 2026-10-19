import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.middleware";
import {
  cronRecordatorios,
  deleteAbono,
  deleteCuenta,
  getAlertas,
  getCuentas,
  postAbono,
  postCuenta,
  postEnviarResumen,
  putAlertas,
  putCuenta,
} from "../controllers/cuentas_cobrar.controller";

export const cuentasCobrarRouter = Router();
// Cuentas por cobrar general: gerencia y administración (Oscar y su secretaria).
const gestion = [requireAuth, requireRole(["superadmin", "gerencia", "admin"])];

// La tarea diaria entra con CRON_SECRET, no con sesión: va antes de las rutas con :id.
cuentasCobrarRouter.get("/cron/recordatorios", cronRecordatorios);

cuentasCobrarRouter.get("/alertas", ...gestion, getAlertas);
cuentasCobrarRouter.put("/alertas", ...gestion, putAlertas);
cuentasCobrarRouter.post("/alertas/enviar", ...gestion, postEnviarResumen);

cuentasCobrarRouter.get("/", ...gestion, getCuentas);
cuentasCobrarRouter.post("/", ...gestion, postCuenta);
cuentasCobrarRouter.put("/:id", ...gestion, putCuenta);
cuentasCobrarRouter.delete("/:id", ...gestion, deleteCuenta);
cuentasCobrarRouter.post("/:id/abonos", ...gestion, postAbono);
cuentasCobrarRouter.delete("/:id/abonos/:abonoId", ...gestion, deleteAbono);
