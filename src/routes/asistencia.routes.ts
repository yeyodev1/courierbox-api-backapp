import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.middleware";
import {
  cronRecordatorios,
  deleteAbono,
  deleteApunte,
  deleteCliente,
  deleteCuenta,
  deletePendiente,
  deleteRecordatorio,
  getAjustes,
  getAlertas,
  getApuntes,
  getClientes,
  getCuentas,
  getPendientes,
  getRecordatorios,
  postAbono,
  postApunte,
  postCliente,
  postCuenta,
  postEnviarRecordatorio,
  postEnviarResumen,
  postPendiente,
  postRecordatorio,
  putAjustes,
  putAlertas,
  putApunte,
  putCliente,
  putCuenta,
  putPendiente,
  putRecordatorio,
} from "../controllers/asistencia.controller";

export const asistenciaRouter = Router();
// Módulo de asistencia: la asistente y Oscar. La asistente no entra al módulo
// de gerencia (sus rutas siguen siendo solo superadmin/gerencia).
const gestion = [requireAuth, requireRole(["superadmin", "asistente"])];

// La tarea diaria entra con CRON_SECRET, no con sesión.
asistenciaRouter.get("/cron/recordatorios", cronRecordatorios);

asistenciaRouter.get("/pendientes", ...gestion, getPendientes);
asistenciaRouter.post("/pendientes", ...gestion, postPendiente);
asistenciaRouter.put("/pendientes/:id", ...gestion, putPendiente);
asistenciaRouter.delete("/pendientes/:id", ...gestion, deletePendiente);

asistenciaRouter.get("/clientes", ...gestion, getClientes);
asistenciaRouter.post("/clientes", ...gestion, postCliente);
asistenciaRouter.put("/clientes/:id", ...gestion, putCliente);
asistenciaRouter.delete("/clientes/:id", ...gestion, deleteCliente);

asistenciaRouter.get("/apuntes", ...gestion, getApuntes);
asistenciaRouter.post("/apuntes", ...gestion, postApunte);
asistenciaRouter.put("/apuntes/:id", ...gestion, putApunte);
asistenciaRouter.delete("/apuntes/:id", ...gestion, deleteApunte);

asistenciaRouter.get("/recordatorios", ...gestion, getRecordatorios);
asistenciaRouter.post("/recordatorios", ...gestion, postRecordatorio);
asistenciaRouter.put("/recordatorios/:id", ...gestion, putRecordatorio);
asistenciaRouter.delete("/recordatorios/:id", ...gestion, deleteRecordatorio);
asistenciaRouter.post("/recordatorios/:id/enviar", ...gestion, postEnviarRecordatorio);

// La libreta de cuentas por cobrar de la asistente: mismas rutas que la de
// gerencia para que el front reutilice la misma pantalla.
asistenciaRouter.get("/cuentas/ajustes", ...gestion, getAjustes);
asistenciaRouter.put("/cuentas/ajustes", ...gestion, putAjustes);
asistenciaRouter.get("/cuentas/alertas", ...gestion, getAlertas);
asistenciaRouter.put("/cuentas/alertas", ...gestion, putAlertas);
asistenciaRouter.post("/cuentas/alertas/enviar", ...gestion, postEnviarResumen);
asistenciaRouter.get("/cuentas", ...gestion, getCuentas);
asistenciaRouter.post("/cuentas", ...gestion, postCuenta);
asistenciaRouter.put("/cuentas/:id", ...gestion, putCuenta);
asistenciaRouter.delete("/cuentas/:id", ...gestion, deleteCuenta);
asistenciaRouter.post("/cuentas/:id/abonos", ...gestion, postAbono);
asistenciaRouter.delete("/cuentas/:id/abonos/:abonoId", ...gestion, deleteAbono);
