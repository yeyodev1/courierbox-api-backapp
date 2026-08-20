import type { Request, Response, NextFunction } from "express";
import xlsx from "xlsx";
import * as GestionCompraService from "../services/gestion_compra.service.js";
import { uploadGestionCompraImagen } from "../services/upload.service.js";
import { models } from "../models/index.js";
import { htmlToPdf } from "../services/pdf.service.js";

function getObjectIdString(value: unknown) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    const maybeId = (value as { _id?: unknown; id?: unknown })._id ?? (value as { _id?: unknown; id?: unknown }).id;
    return String(maybeId ?? "");
  }
  return String(value);
}

function formatDateFilename(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function safeMoney(value: unknown) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getName(value: unknown): string {
  if (!value) return "—";
  if (typeof value === "string") return value || "—";
  if (typeof value === "object" && value !== null) {
    return String((value as { nombre?: string; name?: string }).nombre ?? (value as { nombre?: string; name?: string }).name ?? "—");
  }
  return String(value);
}

function getEmail(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  return String((value as { email?: string }).email ?? "");
}

function stageLabel(stage: string) {
  const map: Record<string, string> = {
    solicitada: "Solicitada",
    revisando: "Revisando",
    comprada: "Comprada",
    en_transito: "En tránsito",
    entregada: "Entregada",
  };
  return map[stage] ?? stage;
}

function estadoLabel(estado: string) {
  const map: Record<string, string> = {
    borrador: "Borrador",
    activa: "Activa",
    completado: "Completado",
    cancelado: "Cancelado",
  };
  return map[estado] ?? estado;
}

function buildExportRows(gestiones: any[]) {
  return gestiones.map((g) => {
    const contacto = g.contactoId;
    const asesor = g.asesorId;
    const valorTotal = Number(g.valorTotal || 0);
    const comision = Number(g.valorComision || 0);
    const costoVenta = Number(g.costoVenta || 0);
    const margenNeto = valorTotal - comision - costoVenta;

    return {
      Fecha: g.createdAt ? new Date(g.createdAt).toLocaleDateString("es-EC") : "—",
      Codigo: String(g._id),
      Cliente: getName(contacto),
      "Email Cliente": getEmail(contacto),
      Asesor: getName(asesor),
      "Email Asesor": getEmail(asesor),
      Estado: estadoLabel(g.estado),
      Stage: stageLabel(g.stage),
      "Valor Total": safeMoney(valorTotal),
      Comision: safeMoney(comision),
      "Costo Venta": safeMoney(costoVenta),
      "Margen Neto": safeMoney(margenNeto),
      Reserva: safeMoney(g.valorReserva),
      "Reserva Confirmada": g.reservaConfirmada ? "Sí" : "No",
      Pagina: g.paginaCompra || "—",
      "Fecha Entrega": g.fechaEntregaTentativa
        ? new Date(g.fechaEntregaTentativa).toLocaleDateString("es-EC")
        : "—",
      Notas: (g.notas || "").replace(/\n/g, " "),
    };
  });
}

const ADMIN_ROLES = ["admin", "superadmin", "gerencia"];

function withoutFinancials(gestion: any) {
  const {
    valorTotal, valorReserva, valorPagado, costoVenta, valorComision, cuentaBancariaId,
    feeConfigId, comprobantePagoUrl, pagoConfirmadoPor, ...safe
  } = gestion;
  return {
    ...safe,
    productos: Array.isArray(safe.productos)
      ? safe.productos.map(({ valorUnitario, valorEnvio, ...producto }: any) => producto)
      : safe.productos,
  };
}

async function resolveUserIdentity(user: any) {
  const userId = String(user?.userId ?? user?.id ?? user?._id ?? "").trim();
  const email = String(user?.email ?? "").trim().toLowerCase();
  const directName = String(user?.name ?? user?.fullName ?? "").trim();

  if (userId) {
    const dbUser = await models.users.findById(userId).select("name email").lean();
    if (dbUser) {
      return {
        userId: String(dbUser._id),
        userName: String(dbUser.name || dbUser.email || directName || email || "Usuario"),
      };
    }

    return {
      userId,
      userName: directName || email || "Usuario",
    };
  }

  if (email) {
    const dbUser = await models.users.findOne({ email }).select("name email").lean();
    if (dbUser) {
      return {
        userId: String(dbUser._id),
        userName: String(dbUser.name || dbUser.email || "Usuario"),
      };
    }
  }

  return null;
}

function getRole(user: any) {
  return String(user?.role ?? "").trim();
}

// GET /api/v1/gestiones-compra
export async function listGestiones(req: Request, res: Response, next: NextFunction) {
  try {
    const role = getRole(req.user);
    const auth = await resolveUserIdentity(req.user);
    if (!auth || !role) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const page = parseInt(String(req.query.page ?? "1"));
    const limit = parseInt(String(req.query.limit ?? "20"));
    const estado = req.query.estado ? String(req.query.estado) : undefined;
    const asesorId = req.query.asesorId ? String(req.query.asesorId) : undefined;
    const mes = req.query.mes ? parseInt(String(req.query.mes)) : undefined;
    const año = req.query.año ? parseInt(String(req.query.año)) : undefined;
    const q = req.query.q ? String(req.query.q) : undefined;

    const result = await GestionCompraService.listGestiones(role, auth.userId, {
      page,
      limit,
      estado,
      asesorId: ADMIN_ROLES.includes(role) ? asesorId : undefined,
      mes,
      año,
      q,
    });

    res.json(role === "bodega"
      ? { ...result, gestiones: result.gestiones.map(withoutFinancials) }
      : result);
  } catch (err) {
    next(err);
  }
}

// GET /api/v1/gestiones-compra/export/excel
export async function exportExcel(req: Request, res: Response, next: NextFunction) {
  try {
    const role = getRole(req.user);
    const auth = await resolveUserIdentity(req.user);
    if (!auth || !role) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const estado = req.query.estado ? String(req.query.estado) : undefined;
    const asesorId = req.query.asesorId ? String(req.query.asesorId) : undefined;
    const mes = req.query.mes ? parseInt(String(req.query.mes)) : undefined;
    const año = req.query.año ? parseInt(String(req.query.año)) : undefined;
    const q = req.query.q ? String(req.query.q) : undefined;

    const gestiones = await GestionCompraService.listAllGestionesForExport(role, auth.userId, {
      estado,
      asesorId: ADMIN_ROLES.includes(role) ? asesorId : undefined,
      mes,
      año,
      q,
    });

    const rows = buildExportRows(gestiones);
    const ws = xlsx.utils.json_to_sheet(rows);
    for (let row = 2; row <= rows.length + 1; row += 1) {
      for (const column of ["I", "J", "K", "L", "M"]) {
        if (ws[`${column}${row}`]) ws[`${column}${row}`].z = "$0.00";
      }
    }

    // Column widths
    const cols = [
      { wch: 24 }, { wch: 14 }, { wch: 28 }, { wch: 28 }, { wch: 14 },
      { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 12 },
      { wch: 14 }, { wch: 18 }, { wch: 36 },
    ];
    ws["!cols"] = cols;

    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "Gestiones de Compra");

    const buf = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });
    const filename = `gestiones_compra_${formatDateFilename(new Date())}.xlsx`;

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.send(buf);
  } catch (err) {
    next(err);
  }
}

// GET /api/v1/gestiones-compra/export/pdf
export async function exportPdf(req: Request, res: Response, next: NextFunction) {
  try {
    const role = getRole(req.user);
    const auth = await resolveUserIdentity(req.user);
    if (!auth || !role) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const estado = req.query.estado ? String(req.query.estado) : undefined;
    const asesorId = req.query.asesorId ? String(req.query.asesorId) : undefined;
    const mes = req.query.mes ? parseInt(String(req.query.mes)) : undefined;
    const año = req.query.año ? parseInt(String(req.query.año)) : undefined;
    const q = req.query.q ? String(req.query.q) : undefined;

    const gestiones = await GestionCompraService.listAllGestionesForExport(role, auth.userId, {
      estado,
      asesorId: ADMIN_ROLES.includes(role) ? asesorId : undefined,
      mes,
      año,
      q,
    });

    const rows = buildExportRows(gestiones);
    const totals = rows.reduce(
      (acc, r) => ({
        valorTotal: acc.valorTotal + Number(r["Valor Total"] || 0),
        comision: acc.comision + Number(r.Comision || 0),
        costoVenta: acc.costoVenta + Number(r["Costo Venta"] || 0),
        margenNeto: acc.margenNeto + Number(r["Margen Neto"] || 0),
      }),
      { valorTotal: 0, comision: 0, costoVenta: 0, margenNeto: 0 }
    );

    const title = "Gestiones de Compra";
    const period = mes && año ? `Período: ${mes}/${año}` : `Generado: ${new Date().toLocaleDateString("es-EC")}`;

    let html = `
      <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: Helvetica, Arial, sans-serif; color: #1f2937; padding: 24px; }
          h1 { font-size: 20px; margin-bottom: 4px; }
          .period { color: #6b7280; font-size: 12px; margin-bottom: 16px; }
          table { width: 100%; border-collapse: collapse; font-size: 10px; }
          th, td { border: 1px solid #d1d5db; padding: 6px; text-align: left; vertical-align: top; }
          th { background: #f3f4f6; font-weight: 700; }
          .right { text-align: right; }
          .totals { margin-top: 16px; font-size: 11px; }
          .totals td { border: none; padding: 4px 6px; }
          .totals .label { font-weight: 700; text-align: right; }
          .totals .value { text-align: right; font-weight: 700; }
        </style>
      </head>
      <body>
        <h1>${title}</h1>
        <div class="period">${period}</div>
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Código</th>
              <th>Cliente</th>
              <th>Asesor</th>
              <th>Estado</th>
              <th>Stage</th>
              <th>Valor Total</th>
              <th>Comisión</th>
              <th>Costo Venta</th>
              <th>Margen Neto</th>
              <th>Reserva</th>
              <th>Página</th>
              <th>Notas</th>
            </tr>
          </thead>
          <tbody>
    `;

    for (const r of rows) {
      html += `
        <tr>
          <td>${escapeHtml(r.Fecha)}</td>
          <td>${escapeHtml(r.Codigo)}</td>
          <td>${escapeHtml(r.Cliente)}</td>
          <td>${escapeHtml(r.Asesor)}</td>
          <td>${escapeHtml(r.Estado)}</td>
          <td>${escapeHtml(r.Stage)}</td>
          <td class="right">${r["Valor Total"]}</td>
          <td class="right">${r.Comision}</td>
          <td class="right">${r["Costo Venta"]}</td>
          <td class="right">${r["Margen Neto"]}</td>
          <td class="right">${r.Reserva}</td>
          <td>${escapeHtml(r.Pagina)}</td>
          <td>${escapeHtml(r.Notas)}</td>
        </tr>`;
    }

    html += `
          </tbody>
        </table>
        <table class="totals">
          <tr><td class="label">Total Gestiones:</td><td class="value">${rows.length}</td></tr>
          <tr><td class="label">Suma Valor Total:</td><td class="value">$${totals.valorTotal.toFixed(2)}</td></tr>
          <tr><td class="label">Suma Comisión:</td><td class="value">$${totals.comision.toFixed(2)}</td></tr>
          <tr><td class="label">Suma Costo Venta:</td><td class="value">$${totals.costoVenta.toFixed(2)}</td></tr>
          <tr><td class="label">Suma Margen Neto:</td><td class="value">$${totals.margenNeto.toFixed(2)}</td></tr>
        </table>
      </body>
      </html>
    `;

    const filename = `gestiones_compra_${formatDateFilename(new Date())}.pdf`;
    const pdf = await htmlToPdf(html);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/pdf");
    res.send(pdf);
  } catch (err) {
    next(err);
  }
}

// POST /api/v1/gestiones-compra
export async function createGestion(req: Request, res: Response, next: NextFunction) {
  try {
    const role = getRole(req.user);
    const auth = await resolveUserIdentity(req.user);
    if (!auth || !role) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const body = req.body;
    const valorTotal = Number(body.valorTotal);
    const valorReserva = Number(body.valorReserva ?? 0);
    if (!Number.isFinite(valorTotal) || valorTotal < 0 || !Number.isFinite(valorReserva) || valorReserva < 0 || valorReserva > valorTotal) {
      res.status(400).json({ error: "La reserva debe estar entre cero y el valor total" });
      return;
    }

    // If asesor, force asesorId to self
    const asesorId = ADMIN_ROLES.includes(role)
      ? (body.asesorId ?? auth.userId)
      : auth.userId;

    if (!asesorId || !auth.userId || !auth.userName) {
      res.status(401).json({ error: "Unauthorized: missing user identity" });
      return;
    }

    const calculatedFee = ADMIN_ROLES.includes(role)
      ? Number(body.valorComision ?? 0)
      : (await GestionCompraService.calcularComisionPreview(valorTotal, body.feeConfigId)).valorComision;
    const gestion = await GestionCompraService.createGestionCompra({
      asesorId,
      contactoId: body.contactoId,
      valorTotal,
      valorReserva,
      cuentaBancariaId: body.cuentaBancariaId,
      costoVenta: ADMIN_ROLES.includes(role) ? Number(body.costoVenta ?? 0) : 0,
      valorComision: calculatedFee,
      feeConfigId: body.feeConfigId,
      paginaCompra: body.paginaCompra,
      fechaEntregaTentativa: body.fechaEntregaTentativa,
      imagenCompraUrl: body.imagenCompraUrl,
      notas: body.notas,
      tipoServicio: body.serviceType ?? body.tipoServicio,
      prioridad: body.prioridad,
      fechaLimiteCompra: body.fechaLimiteCompra,
      productos: body.productos,
      createdByUserId: auth.userId,
      createdByUserName: auth.userName,
    });

    res.status(201).json({ gestion });
  } catch (err) {
    next(err);
  }
}

// GET /api/v1/gestiones-compra/stats/mensual
export async function getStatsMensuales(req: Request, res: Response, next: NextFunction) {
  try {
    const role = getRole(req.user);
    const auth = await resolveUserIdentity(req.user);
    if (!auth || !role) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const now = new Date();
    const año = parseInt(String(req.query.año ?? now.getFullYear()));
    const mes = req.query.mes ? parseInt(String(req.query.mes)) : undefined;
    const asesorId = req.query.asesorId ? String(req.query.asesorId) : undefined;
    const q = req.query.q ? String(req.query.q) : undefined;

    const targetAsesorId = ADMIN_ROLES.includes(role) ? (asesorId || undefined) : auth.userId;

    const stats = await GestionCompraService.getEstadisticasMensuales(
      año,
      mes,
      targetAsesorId,
      q
    );

    res.json(stats);
  } catch (err) {
    next(err);
  }
}

// GET /api/v1/gestiones-compra/view/:token (public — no auth)
export async function getByToken(req: Request, res: Response, next: NextFunction) {
  try {
    const gestion = await GestionCompraService.getGestionByViewToken(String(req.params.token));
    if (!gestion) return res.status(404).json({ error: "Gestión no encontrada" });
    const contacto = typeof gestion.contactoId === "object" ? gestion.contactoId as any : null;
    const asesor = typeof gestion.asesorId === "object" ? gestion.asesorId as any : null;
    const envio = await models.enviosDomicilio.findOne({ gestionCompraId: gestion._id })
      .select("modo estado guiaUrl fotoEntregaUrl firmaUrl entregadoEn recibidoPorNombre recibidoPorApellido")
      .lean();
    const evidenceBaseUrl = `${req.protocol}://${req.get("host")}${req.baseUrl}/view/${encodeURIComponent(String(req.params.token))}/evidence`;
    res.json({
      gestion: {
        _id: String(gestion._id),
        contactoId: { nombre: contacto?.nombre ?? "Cliente" },
        asesorId: { name: asesor?.name ?? "Courier Box" },
        valorTotal: gestion.valorTotal,
        valorReserva: gestion.valorReserva,
        paginaCompra: gestion.paginaCompra,
        fechaEntregaTentativa: gestion.fechaEntregaTentativa,
        imagenCompraUrl: gestion.imagenCompraUrl ? `${evidenceBaseUrl}/compra-principal` : "",
        fotosRelacionadas: (gestion.fotosRelacionadas ?? []).map((foto: any, index: number) => ({
          title: foto.title,
          createdAt: foto.createdAt,
          url: `${evidenceBaseUrl}/compra-${index}`,
        })),
        stage: gestion.stage,
        estado: gestion.estado,
        estadoPago: gestion.estadoPago ?? "pendiente",
        estadoCompra: gestion.estadoCompra ?? "pendiente",
        estadoBodega: gestion.estadoBodega ?? "pendiente",
        estadoEntrega: gestion.estadoEntrega ?? "sin_envio",
        pagoConfirmadoEn: gestion.pagoConfirmadoEn,
        createdAt: gestion.createdAt,
        updatedAt: gestion.updatedAt,
        envio: envio ? {
          modo: envio.modo,
          estado: envio.estado,
          guiaUrl: envio.guiaUrl,
          fotoEntregaUrl: envio.fotoEntregaUrl ? `${evidenceBaseUrl}/foto` : "",
          firmaUrl: envio.firmaUrl ? `${evidenceBaseUrl}/firma` : "",
          entregadoEn: envio.entregadoEn,
          recibidoPor: [envio.recibidoPorNombre, envio.recibidoPorApellido].filter(Boolean).join(" "),
        } : null,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function getEvidenceByToken(req: Request, res: Response, next: NextFunction) {
  try {
    const gestion = await GestionCompraService.getGestionByViewToken(String(req.params.token));
    if (!gestion) return void res.status(404).json({ error: "Gestión no encontrada" });
    const envio = await models.enviosDomicilio.findOne({ gestionCompraId: gestion._id }).select("fotoEntregaUrl firmaUrl").lean();
    let source = req.params.type === "foto" ? envio?.fotoEntregaUrl : req.params.type === "firma" ? envio?.firmaUrl : "";
    if (req.params.type === "compra-principal") source = gestion.imagenCompraUrl;
    const galleryMatch = /^compra-(\d+)$/.exec(String(req.params.type));
    if (galleryMatch) source = gestion.fotosRelacionadas?.[Number(galleryMatch[1])]?.url;
    if (!source) return void res.status(404).json({ error: "Evidencia no encontrada" });
    const sourceUrl = new URL(source);
    if (sourceUrl.protocol !== "https:" || sourceUrl.hostname !== "res.cloudinary.com") {
      return void res.status(400).json({ error: "Origen de evidencia no permitido" });
    }
    const upstream = await fetch(sourceUrl);
    if (!upstream.ok) return void res.status(502).json({ error: "No se pudo recuperar la evidencia" });
    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "private, no-store");
    res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    next(err);
  }
}

// GET /api/v1/gestiones-compra/:id
export async function getGestion(req: Request, res: Response, next: NextFunction) {
  try {
    const role = getRole(req.user);
    const auth = await resolveUserIdentity(req.user);
    if (!auth || !role) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const gestion = await GestionCompraService.getGestionById(String(req.params.id));
    if (!gestion) return res.status(404).json({ error: "Gestión no encontrada" });

    // Bodega can inspect operational data; advisors can only inspect their own records.
    if (role !== "bodega" && !ADMIN_ROLES.includes(role) && getObjectIdString(gestion.asesorId) !== auth.userId) {
      return res.status(403).json({ error: "Sin acceso a esta gestión" });
    }
    const envio = await models.enviosDomicilio.findOne({ gestionCompraId: gestion._id })
      .select("modo estado guiaUrl fotoEntregaUrl firmaUrl entregadoEn recibidoPorNombre recibidoPorApellido recibidoPorCedula bitacora")
      .lean();
    const operationIds = [gestion._id, ...(envio?._id ? [envio._id] : [])];
    const notificaciones = await models.notificaciones.find({ operacionId: { $in: operationIds } })
      .select("evento destinatario estado intentos providerId ultimoError enviadaEn createdAt")
      .sort({ createdAt: -1 })
      .lean();
    const normalizedEnvio = envio ? {
      ...envio,
      recibidoPor: [envio.recibidoPorNombre, envio.recibidoPorApellido].filter(Boolean).join(" "),
    } : null;
    const detail = { ...gestion, envio: normalizedEnvio, notificaciones };
    res.json({ gestion: role === "bodega" ? withoutFinancials(detail) : detail });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/v1/gestiones-compra/:id
export async function updateGestion(req: Request, res: Response, next: NextFunction) {
  try {
    const role = getRole(req.user);
    const auth = await resolveUserIdentity(req.user);
    if (!auth || !role) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const existing = await GestionCompraService.getGestionById(String(req.params.id));
    if (!existing) return res.status(404).json({ error: "Gestión no encontrada" });

    if (!ADMIN_ROLES.includes(role) && getObjectIdString(existing.asesorId) !== auth.userId) {
      return res.status(403).json({ error: "Sin acceso" });
    }

    const updated = await GestionCompraService.updateGestion(
      String(req.params.id),
      role,
      req.body,
      auth.userId,
      auth.userName
    );

    res.json({ gestion: updated });
  } catch (err) {
    next(err);
  }
}

// POST /api/v1/gestiones-compra/:id/confirmar-reserva (admin only)
export async function confirmarReserva(req: Request, res: Response, next: NextFunction) {
  try {
    const auth = await resolveUserIdentity(req.user);
    if (!auth) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const gestion = await GestionCompraService.confirmarReserva(String(req.params.id), auth.userId, auth.userName);
    if (!gestion) return res.status(404).json({ error: "Gestión no encontrada" });
    res.json({ gestion });
  } catch (err) {
    next(err);
  }
}

export async function confirmarPago(req: Request, res: Response, next: NextFunction) {
  try {
    const auth = await resolveUserIdentity(req.user);
    if (!auth) return void res.status(401).json({ error: "Unauthorized" });
    const gestion = await GestionCompraService.confirmarPago(String(req.params.id), Number(req.body.monto), auth.userId, auth.userName);
    if (!gestion) return void res.status(404).json({ error: "Gestión no encontrada o pago ya confirmado" });
    res.json({ gestion });
  } catch (err) {
    next(err);
  }
}

export async function asignarComprador(req: Request, res: Response, next: NextFunction) {
  try {
    const auth = await resolveUserIdentity(req.user);
    if (!auth) return void res.status(401).json({ error: "Unauthorized" });
    const gestion = await GestionCompraService.asignarComprador(String(req.params.id), String(req.body.compradorId || ""), auth.userId, auth.userName);
    if (!gestion) return void res.status(404).json({ error: "Gestión no encontrada" });
    res.json({ gestion });
  } catch (err) {
    next(err);
  }
}

export async function marcarComprada(req: Request, res: Response, next: NextFunction) {
  try {
    const role = getRole(req.user);
    const auth = await resolveUserIdentity(req.user);
    if (!auth || !role) return void res.status(401).json({ error: "Unauthorized" });
    const existing = await GestionCompraService.getGestionById(String(req.params.id));
    if (!existing) return void res.status(404).json({ error: "Gestión no encontrada" });
    const isOwner = getObjectIdString(existing.asesorId) === auth.userId;
    const isAssignedBuyer = getObjectIdString(existing.compradorAsignadoId) === auth.userId;
    if (!ADMIN_ROLES.includes(role) && !isOwner && !isAssignedBuyer) {
      return void res.status(403).json({ error: "Sin acceso a esta gestión" });
    }
    const gestion = await GestionCompraService.marcarComprada(String(req.params.id), String(req.body.numeroOrden || ""), auth.userId, auth.userName);
    if (!gestion) return void res.status(409).json({ error: "La gestión no puede marcarse comprada en su estado actual" });
    res.json({ gestion });
  } catch (err) {
    next(err);
  }
}

export async function getBitacora(req: Request, res: Response, next: NextFunction) {
  try {
    const role = getRole(req.user);
    const auth = await resolveUserIdentity(req.user);
    if (!auth || !role) return void res.status(401).json({ error: "Unauthorized" });
    const gestion = await GestionCompraService.getGestionById(String(req.params.id));
    if (!gestion) return void res.status(404).json({ error: "Gestión no encontrada" });
    if (role !== "bodega" && !ADMIN_ROLES.includes(role) && getObjectIdString(gestion.asesorId) !== auth.userId) {
      return void res.status(403).json({ error: "Sin acceso a esta gestión" });
    }
    res.json({ bitacora: gestion.auditLog ?? [] });
  } catch (err) {
    next(err);
  }
}

// POST /api/v1/gestiones-compra/:id/notificar (re-enviar)
export async function reNotificar(req: Request, res: Response, next: NextFunction) {
  try {
    await GestionCompraService.sendNotificacionCliente(String(req.params.id), true);
    res.json({ ok: true, message: "Notificación reenviada" });
  } catch (err) {
    next(err);
  }
}

// GET /api/v1/gestiones-compra/comision-preview?valorTotal=&feeConfigId=
export async function comisionPreview(req: Request, res: Response, next: NextFunction) {
  try {
    const valorTotal = Number(String(req.query.valorTotal ?? "0"));
    const feeConfigId = req.query.feeConfigId ? String(req.query.feeConfigId) : undefined;

    if (isNaN(valorTotal) || valorTotal <= 0) {
      return res.status(400).json({ error: "valorTotal inválido" });
    }

    const result = await GestionCompraService.calcularComisionPreview(valorTotal, feeConfigId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

// POST /api/v1/gestiones-compra/:id/recepcion-bodega
export async function recepcionBodega(req: Request, res: Response, next: NextFunction) {
  try {
    const auth = await resolveUserIdentity(req.user);
    if (!auth) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const fotos = Array.isArray(req.body.fotos)
      ? req.body.fotos
          .map((f: any) => (typeof f === "string" ? { url: f } : { url: f?.url, title: f?.title }))
          .filter((f: any) => f.url)
      : [];

    const gestion = await GestionCompraService.registrarRecepcionBodega(
      String(req.params.id),
      { fotos, notas: req.body.notas, enviarCorreo: req.body.enviarCorreo, entregaEstimada: req.body.entregaEstimada },
      auth.userId,
      auth.userName
    );

    if (!gestion) {
      res.status(404).json({ error: "Gestión no encontrada" });
      return;
    }

    res.json({ gestion });
  } catch (err) {
    next(err);
  }
}

// POST /api/v1/gestiones-compra/upload-imagen (multipart)
export async function uploadImagen(req: Request, res: Response, next: NextFunction) {
  try {
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) return res.status(400).json({ error: "No se recibió archivo" });

    const result = await uploadGestionCompraImagen(file.buffer);

    res.json({ url: result.url });
  } catch (err) {
    next(err);
  }
}
