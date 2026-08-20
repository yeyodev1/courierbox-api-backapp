import { Resend } from "resend";
import { env } from "../config/env";
import { WHATSAPP_DISPLAY, whatsappLink } from "../config/contact";

let resend: Resend | null = null;

export interface EmailDeliveryResult {
  success: boolean;
  providerId?: string;
  error?: string;
}

function escapeEmailHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[character] || character);
}

function safeEmailUrl(value: string): string {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("URL de correo no permitida");
  return escapeEmailHtml(url.toString());
}

export async function sendGestionLifecycleEmail(params: {
  to: string;
  clientName: string;
  subject: string;
  title: string;
  message: string;
  viewUrl: string;
}): Promise<EmailDeliveryResult> {
  const client = getClient();
  if (!client) return { success: false, error: "RESEND_API_KEY no configurado" };
  try {
    const clientName = escapeEmailHtml(params.clientName);
    const title = escapeEmailHtml(params.title);
    const message = escapeEmailHtml(params.message);
    const viewUrl = safeEmailUrl(params.viewUrl);
    const response = await client.emails.send({
      from: `Courier Box <${env.EMAIL_FROM}>`,
      to: params.to,
      subject: params.subject,
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#17130f;color:#fff;padding:24px;border-radius:12px"><h1 style="color:#f57c00">${title}</h1><p>Hola <strong>${clientName}</strong>,</p><p>${message}</p><p style="text-align:center;margin:24px 0"><a href="${viewUrl}" style="background:#f57c00;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">Ver mi compra</a></p></div>`,
    });
    if (response.error) return { success: false, error: response.error.message };
    return { success: true, providerId: response.data?.id };
  } catch (err) {
    return { success: false, error: emailError(err) };
  }
}

function emailError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error || "Error desconocido al enviar correo");
}

function getClient(): Resend | null {
  if (!env.RESEND_API_KEY) {
    console.warn("[email] RESEND_API_KEY not configured — skipping email");
    return null;
  }
  if (!resend) {
    resend = new Resend(env.RESEND_API_KEY);
  }
  return resend;
}

export async function sendCompraConfirmacion(params: {
  to: string;
  clientName: string;
  orderId: string;
  storeName: string;
  description: string;
  totalAmount: number;
  trackingUsa?: string;
  viewUrl?: string;
}): Promise<void> {
  const client = getClient();
  if (!client) return;

  try {
    await client.emails.send({
      from: `Courier Box <${env.EMAIL_FROM}>`,
      to: params.to,
      subject: "Tu pedido ha sido comprado ✅",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #f57c00; padding: 24px; border-radius: 12px 12px 0 0;">
            <h1 style="color: #fff; margin: 0; font-size: 1.5rem;">Pedido Comprado</h1>
          </div>
          <div style="background: #1a1a1a; color: #e0e0e0; padding: 24px; border-radius: 0 0 12px 12px;">
            <p>Hola <strong>${params.clientName}</strong>,</p>
            <p>Tu pedido ha sido comprado exitosamente por nuestro equipo. Aquí están los detalles:</p>
            <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
              <tr>
                <td style="padding: 8px; color: #999; width: 120px;">Tienda</td>
                <td style="padding: 8px;"><strong>${params.storeName}</strong></td>
              </tr>
              <tr style="background: #252525;">
                <td style="padding: 8px; color: #999;">Producto</td>
                <td style="padding: 8px;"><strong>${params.description}</strong></td>
              </tr>
              <tr>
                <td style="padding: 8px; color: #999;">Total</td>
                <td style="padding: 8px;"><strong>$${params.totalAmount.toFixed(2)}</strong></td>
              </tr>
              ${
                params.trackingUsa
                  ? `<tr style="background: #252525;">
                       <td style="padding: 8px; color: #999;">Tracking USA</td>
                       <td style="padding: 8px;"><strong>${params.trackingUsa}</strong></td>
                     </tr>`
                  : ""
              }
            </table>
            <p>Te mantendremos informado cuando llegue a nuestro warehouse y esté listo para envío a domicilio.</p>
            ${params.viewUrl ? `<p style="text-align:center; margin: 24px 0;"><a href="${params.viewUrl}" style="background: #f57c00; color: #fff; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block;">Ver mi pedido</a></p>` : ""}
            <p style="color: #999; font-size: 0.85rem;">Si tienes dudas, contacta a tu asesor.</p>
          </div>
        </div>
      `,
    });
    console.log(`[email] purchase confirmation sent to ${params.to}`);
  } catch (err) {
    console.error("[email] failed to send:", err);
  }
}

export async function sendGestionCompraConfirmacion(params: {
  to: string;
  clientName: string;
  gestionId: string;
  valorTotal: number;
  fechaEntregaTentativa: Date;
  paginaCompra: string;
  imagenCompraUrl?: string;
  viewUrl: string;
  asesorNombre: string;
}): Promise<EmailDeliveryResult> {
  const client = getClient();
  if (!client) return { success: false, error: "RESEND_API_KEY no configurado" };

  const fechaFormateada = new Date(params.fechaEntregaTentativa).toLocaleDateString("es-EC", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const imagenHtml = params.imagenCompraUrl
    ? `<div style="margin: 16px 0; text-align: center;">
         <img src="${params.imagenCompraUrl}" alt="Imagen de compra" style="max-width: 100%; border-radius: 8px; border: 1px solid #333;" />
       </div>`
    : "";

  try {
    const response = await client.emails.send({
      from: `Courier Box <${env.EMAIL_FROM}>`,
      to: params.to,
      subject: "Tu gestión de compra ha sido registrada",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #f57c00; padding: 24px; border-radius: 12px 12px 0 0;">
            <h1 style="color: #fff; margin: 0; font-size: 1.5rem;">Gestión de Compra Registrada</h1>
          </div>
          <div style="background: #1a1a1a; color: #e0e0e0; padding: 24px; border-radius: 0 0 12px 12px;">
            <p>Hola <strong>${params.clientName}</strong>,</p>
            <p>Tu gestión de compra ha sido registrada exitosamente. Aquí están los detalles:</p>
            <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
              <tr>
                <td style="padding: 8px; color: #999; width: 140px;">Total</td>
                <td style="padding: 8px;"><strong style="color: #f57c00;">$${params.valorTotal.toFixed(2)}</strong></td>
              </tr>
              <tr style="background: #252525;">
                <td style="padding: 8px; color: #999;">Tienda</td>
                <td style="padding: 8px;"><strong>${params.paginaCompra}</strong></td>
              </tr>
              <tr>
                <td style="padding: 8px; color: #999;">Entrega tentativa</td>
                <td style="padding: 8px;"><strong>${fechaFormateada}</strong></td>
              </tr>
              <tr style="background: #252525;">
                <td style="padding: 8px; color: #999;">Asesor</td>
                <td style="padding: 8px;"><strong>${params.asesorNombre}</strong></td>
              </tr>
            </table>
            ${imagenHtml}
            <div style="text-align: center; margin: 24px 0;">
              <a href="${params.viewUrl}" style="background: #f57c00; color: #fff; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block;">
                Ver estado de mi compra
              </a>
            </div>
            <hr style="border-color: #333; margin: 24px 0;" />
            <h3 style="color: #f57c00; margin-top: 0;">Términos y Condiciones</h3>
            <p style="color: #aaa; font-size: 0.82rem; line-height: 1.6;">
              Al solicitar el servicio de gestión de compra con Courier Box Logistics, el cliente acepta que:
              (1) Los tiempos de entrega son estimados y pueden variar por factores externos al courier.
              (2) El valor de reserva no es reembolsable en caso de cancelación del pedido por parte del cliente.
              (3) Courier Box no se responsabiliza por demoras aduaneras ni restricciones de importación.
              (4) El cliente debe verificar que el producto no esté restringido para importación al Ecuador.
              (5) Los precios incluyen el servicio de compra internacional; costos adicionales de aduana o
              impuestos serán informados oportunamente.
            </p>
            <p style="color: #666; font-size: 0.8rem; margin-top: 24px;">
              Courier Box Logistics · courierboxlogistics.com
            </p>
          </div>
        </div>
      `,
    });
    if (response.error) return { success: false, error: response.error.message };
    console.log(`[email] gestion compra confirmation sent to ${params.to}`);
    return { success: true, providerId: response.data?.id };
  } catch (err) {
    console.error("[email] failed to send gestion compra confirmation:", err);
    return { success: false, error: emailError(err) };
  }
}

export async function sendRecepcionBodegaCliente(params: {
  to: string;
  clientName: string;
  fotos: string[];
  viewUrl: string;
  asesorNombre?: string;
  notas?: string;
  entregaEstimada?: string;
}): Promise<EmailDeliveryResult> {
  const client = getClient();
  if (!client) return { success: false, error: "RESEND_API_KEY no configurado" };

  const fotosHtml = params.fotos.length
    ? `<div style="margin: 16px 0; display:flex; flex-wrap:wrap; gap:8px; justify-content:center;">
         ${params.fotos
           .map(
             (url) =>
               `<img src="${url}" alt="Producto en bodega" style="width: 46%; border-radius: 8px; border: 1px solid #333;" />`
           )
           .join("")}
       </div>`
    : "";

  try {
    const response = await client.emails.send({
      from: `Courier Box <${env.EMAIL_FROM}>`,
      to: params.to,
      subject: "Tu producto llegó a nuestra bodega 📦",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #f57c00; padding: 24px; border-radius: 12px 12px 0 0;">
            <h1 style="color: #fff; margin: 0; font-size: 1.5rem;">Producto recibido en bodega</h1>
          </div>
          <div style="background: #1a1a1a; color: #e0e0e0; padding: 24px; border-radius: 0 0 12px 12px;">
            <p>Hola <strong>${params.clientName}</strong>,</p>
            <p>¡Buenas noticias! Tu producto llegó a nuestra bodega y está siendo procesado para su envío.</p>
            ${
              params.entregaEstimada
                ? `<div style="margin:16px 0; padding:12px 16px; background:#252525; border-radius:8px; border-left:3px solid #f57c00;">
                     <span style="color:#999; font-size:0.8rem;">Tiempo estimado de entrega</span><br/>
                     <strong style="color:#f57c00; font-size:1.05rem;">${params.entregaEstimada}</strong>
                   </div>`
                : ""
            }
            ${fotosHtml}
            ${params.notas ? `<p style="color:#aaa;">${params.notas}</p>` : ""}
            <div style="text-align: center; margin: 24px 0;">
              <a href="${params.viewUrl}" style="background: #f57c00; color: #fff; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block;">
                Ver estado de mi pedido
              </a>
            </div>
            <p style="color: #666; font-size: 0.8rem; margin-top: 24px;">Courier Box Logistics · courierboxlogistics.com</p>
          </div>
        </div>
      `,
    });
    if (response.error) return { success: false, error: response.error.message };
    console.log(`[email] recepcion bodega sent to ${params.to}`);
    return { success: true, providerId: response.data?.id };
  } catch (err) {
    console.error("[email] failed to send recepcion bodega:", err);
    return { success: false, error: emailError(err) };
  }
}

export async function sendEnvioEnCaminoCliente(params: {
  to: string;
  clienteNombre: string;
  direccion: string;
  modo: "local" | "interprovincial";
  valorCobrado?: number;
  proveedor?: string;
  guiaUrl?: string;
  ciudadDestino?: string;
}): Promise<EmailDeliveryResult> {
  const client = getClient();
  if (!client) return { success: false, error: "RESEND_API_KEY no configurado" };

  const esInter = params.modo === "interprovincial";
  const titulo = esInter ? "Tu pedido fue despachado 🚚" : "Tu guía de envío fue generada 🛵";
  const intro = esInter
    ? "Tu pedido fue despachado con nuestro proveedor de mensajería y está en camino."
    : "Generamos la guía de tu envío y tu pedido está en camino a la dirección indicada.";

  const guiaHtml = params.guiaUrl
    ? `<div style="margin: 16px 0; text-align: center;">
         <a href="${params.guiaUrl}" style="color:#f57c00;">Ver guía de envío</a>
       </div>`
    : "";

  try {
    const response = await client.emails.send({
      from: `Courier Box <${env.EMAIL_FROM}>`,
      to: params.to,
      subject: titulo,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #f57c00; padding: 24px; border-radius: 12px 12px 0 0;">
            <h1 style="color: #fff; margin: 0; font-size: 1.5rem;">${esInter ? "Pedido despachado" : "Envío en camino"}</h1>
          </div>
          <div style="background: #1a1a1a; color: #e0e0e0; padding: 24px; border-radius: 0 0 12px 12px;">
            <p>Hola <strong>${params.clienteNombre}</strong>,</p>
            <p>${intro}</p>
            <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
              <tr>
                <td style="padding: 8px; color: #999; width: 140px;">Dirección</td>
                <td style="padding: 8px;"><strong>${params.direccion}</strong></td>
              </tr>
              ${
                params.ciudadDestino
                  ? `<tr style="background:#252525;"><td style="padding: 8px; color: #999;">Ciudad</td><td style="padding: 8px;"><strong>${params.ciudadDestino}</strong></td></tr>`
                  : ""
              }
              ${
                esInter && params.proveedor
                  ? `<tr><td style="padding: 8px; color: #999;">Transportadora</td><td style="padding: 8px;"><strong>${params.proveedor}</strong></td></tr>`
                  : ""
              }
              ${
                !esInter && typeof params.valorCobrado === "number"
                  ? `<tr><td style="padding: 8px; color: #999;">Valor de envío</td><td style="padding: 8px;"><strong>$${params.valorCobrado.toFixed(2)}</strong></td></tr>`
                  : ""
              }
            </table>
            ${guiaHtml}
            <p>Te avisaremos cuando sea entregado.</p>
            <p style="color: #666; font-size: 0.8rem; margin-top: 24px;">Courier Box Logistics · courierboxlogistics.com</p>
          </div>
        </div>
      `,
    });
    if (response.error) return { success: false, error: response.error.message };
    console.log(`[email] envio en camino sent to ${params.to}`);
    return { success: true, providerId: response.data?.id };
  } catch (err) {
    console.error("[email] failed to send envio en camino:", err);
    return { success: false, error: emailError(err) };
  }
}

export async function sendEntregaConfirmacion(params: {
  to: string;
  clienteNombre: string;
  direccion: string;
  fotoEntregaUrl?: string;
  firmaUrl?: string;
  motorizadoNombre?: string;
  novedad?: string;
  recibidoPor?: string;
  recibidoPorCedula?: string;
  recibidoPorContacto?: string;
}): Promise<EmailDeliveryResult> {
  const client = getClient();
  if (!client) return { success: false, error: "RESEND_API_KEY no configurado" };

  const fecha = new Date().toLocaleString("es-EC", {
    dateStyle: "long",
    timeStyle: "short",
  });

  const fotoHtml = params.fotoEntregaUrl
    ? `<div style="margin: 16px 0; text-align: center;">
         <p style="color:#999; font-size:0.8rem; margin:0 0 6px;">Foto de la entrega</p>
         <img src="${params.fotoEntregaUrl}" alt="Entrega" style="max-width: 100%; border-radius: 8px; border: 1px solid #333;" />
       </div>`
    : "";

  const firmaHtml = params.firmaUrl
    ? `<div style="margin: 16px 0; text-align: center;">
         <p style="color:#999; font-size:0.8rem; margin:0 0 6px;">Firma de recepción</p>
         <img src="${params.firmaUrl}" alt="Firma" style="max-width: 260px; background:#fff; border-radius: 8px; border: 1px solid #333; padding: 4px;" />
       </div>`
    : "";

  try {
    const response = await client.emails.send({
      from: `Courier Box <${env.EMAIL_FROM}>`,
      to: params.to,
      subject: "Tu pedido fue entregado ✅",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #f57c00; padding: 24px; border-radius: 12px 12px 0 0;">
            <h1 style="color: #fff; margin: 0; font-size: 1.5rem;">Entrega completada</h1>
          </div>
          <div style="background: #1a1a1a; color: #e0e0e0; padding: 24px; border-radius: 0 0 12px 12px;">
            <p>Hola <strong>${params.clienteNombre}</strong>,</p>
            <p>Tu pedido fue entregado exitosamente. Aquí está el respaldo de la entrega:</p>
            <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
              <tr>
                <td style="padding: 8px; color: #999; width: 140px;">Dirección</td>
                <td style="padding: 8px;"><strong>${params.direccion}</strong></td>
              </tr>
              <tr style="background: #252525;">
                <td style="padding: 8px; color: #999;">Fecha y hora</td>
                <td style="padding: 8px;"><strong>${fecha}</strong></td>
              </tr>
              ${
                params.motorizadoNombre
                  ? `<tr>
                       <td style="padding: 8px; color: #999;">Entregado por</td>
                       <td style="padding: 8px;"><strong>${params.motorizadoNombre}</strong></td>
                     </tr>`
                  : ""
              }
              ${
                params.recibidoPor
                  ? `<tr>
                       <td style="padding: 8px; color: #999;">Recibido por</td>
                       <td style="padding: 8px;"><strong>${params.recibidoPor}${params.recibidoPorCedula ? ` · CI ${params.recibidoPorCedula}` : ""}${params.recibidoPorContacto ? ` · ${params.recibidoPorContacto}` : ""}</strong></td>
                     </tr>`
                  : ""
              }
              ${
                params.novedad
                  ? `<tr style="background: #252525;">
                       <td style="padding: 8px; color: #999;">Observaciones</td>
                       <td style="padding: 8px;"><strong>${params.novedad}</strong></td>
                     </tr>`
                  : ""
              }
            </table>
            ${fotoHtml}
            ${firmaHtml}
            <p style="color: #999; font-size: 0.85rem;">Gracias por confiar en Courier Box Logistics.</p>
            <p style="color: #666; font-size: 0.8rem; margin-top: 24px;">Courier Box Logistics · courierboxlogistics.com</p>
          </div>
        </div>
      `,
    });
    if (response.error) return { success: false, error: response.error.message };
    console.log(`[email] entrega confirmation sent to ${params.to}`);
    return { success: true, providerId: response.data?.id };
  } catch (err) {
    console.error("[email] failed to send entrega confirmation:", err);
    return { success: false, error: emailError(err) };
  }
}

export async function sendCredenciales(params: {
  to: string;
  name: string;
  email: string;
  password: string;
  role: string;
  loginUrl: string;
}): Promise<void> {
  const client = getClient();
  if (!client) return;

  const roleLabel =
    params.role === "admin"
      ? "Administrador"
      : params.role === "asesor"
        ? "Asesor de compras"
        : "Usuario";

  try {
    await client.emails.send({
      from: `Courier Box <${env.EMAIL_FROM}>`,
      to: params.to,
      subject: `Tus credenciales de acceso · Courier Box`,
      text: `Hola ${params.name},

Se ha creado una cuenta para ti en el panel de administraci\u00f3n de Courier Box.

Tus credenciales de acceso son:

  Correo:      ${params.email}
  Contrase\u00f1a:  ${params.password}
  Rol:         ${roleLabel}

Ingresa aqu\u00ed: ${params.loginUrl}

Por seguridad, te recomendamos cambiar tu contrase\u00f1a despu\u00e9s de iniciar sesi\u00f3n.

--
Courier Box Logistics`,
    });
    console.log(`[email] credentials sent to ${params.to}`);
  } catch (err) {
    console.error("[email] failed to send credentials:", err);
  }
}

/** Acknowledges a self-service purchase request from the public site. */
export async function sendSolicitudRecibida(params: {
  to: string;
  clienteNombre: string;
  folio: string;
  totalItems: number;
  subtotal: number;
  comisionEstimada: number;
  totalEstimado: number;
  items?: Array<{ titulo?: string; url?: string; cantidad?: number }>;
}): Promise<EmailDeliveryResult> {
  const client = getClient();
  if (!client) return { success: false, error: "RESEND_API_KEY no configurado" };
  if (!params.to) return { success: false, error: "Solicitud sin correo" };

  const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;

  const filas = (params.items ?? [])
    .map(
      (i) => `
        <tr>
          <td style="padding:8px 10px; border-bottom:1px solid #2a2a2a;">${escapeEmailHtml(i.titulo)}</td>
          <td style="padding:8px 10px; border-bottom:1px solid #2a2a2a; text-align:right; color:#aaa;">x${Number(i.cantidad) || 1}</td>
        </tr>`
    )
    .join("");

  try {
    const response = await client.emails.send({
      from: `Courier Box <${env.EMAIL_FROM}>`,
      to: params.to,
      subject: `Recibimos tu solicitud de compra #${params.folio}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background:#f57c00; padding:24px; border-radius:12px 12px 0 0;">
            <h1 style="color:#fff; margin:0; font-size:1.5rem;">Solicitud recibida</h1>
            <p style="color:rgba(255,255,255,0.85); margin:6px 0 0; font-size:0.85rem;">Folio #${escapeEmailHtml(params.folio)}</p>
          </div>
          <div style="background:#1a1a1a; color:#e0e0e0; padding:24px; border-radius:0 0 12px 12px;">
            <p>Hola <strong>${escapeEmailHtml(params.clienteNombre)}</strong>,</p>
            <p>
              Recibimos tu solicitud de <strong>${params.totalItems}</strong> producto(s).
              Un asesor la revisa y te confirma disponibilidad y el total final.
            </p>

            ${
              filas
                ? `<table style="width:100%; border-collapse:collapse; margin:18px 0; font-size:0.85rem;"><tbody>${filas}</tbody></table>`
                : ""
            }

            <div style="padding:14px 16px; background:#252525; border-radius:8px; border-left:3px solid #f57c00;">
              <table style="width:100%; font-size:0.9rem;">
                <tr><td style="color:#999; padding:4px 0;">Productos + envío en EE.UU.</td><td style="text-align:right;">${money(params.subtotal)}</td></tr>
                <tr><td style="color:#999; padding:4px 0;">Comisión estimada</td><td style="text-align:right;">${money(params.comisionEstimada)}</td></tr>
                <tr><td style="color:#fff; padding:8px 0 0; font-weight:bold;">Total estimado</td><td style="text-align:right; color:#f57c00; font-size:1.15rem; font-weight:bold; padding-top:8px;">${money(params.totalEstimado)}</td></tr>
              </table>
            </div>

            <p style="color:#888; font-size:0.78rem; margin-top:14px;">
              Es una estimación: no incluye el flete internacional a Ecuador ni impuestos aduaneros,
              que dependen del peso y la categoría del producto.
            </p>

            <div style="text-align:center; margin:20px 0 4px;">
              <a href="${safeEmailUrl(
                whatsappLink(
                  `Hola Courier Box, soy ${params.clienteNombre}. Envié la solicitud de compra #${params.folio} y quiero confirmarla.`
                )
              )}" style="background:#25D366; color:#fff; padding:12px 28px; border-radius:8px; text-decoration:none; font-weight:bold; display:inline-block;">
                Confirmar por WhatsApp
              </a>
              <p style="color:#777; font-size:0.72rem; margin:8px 0 0;">${WHATSAPP_DISPLAY}</p>
            </div>

            <p style="color:#666; font-size:0.8rem; margin-top:24px;">Courier Box Logistics · courierboxlogistics.com</p>
          </div>
        </div>
      `,
    });
    if (response.error) return { success: false, error: response.error.message };
    console.log(`[email] solicitud ${params.folio} sent to ${params.to}`);
    return { success: true, providerId: response.data?.id };
  } catch (err) {
    console.error("[email] failed to send solicitud:", err);
    return { success: false, error: emailError(err) };
  }
}

/** Electronic invoice issued at the counter and synced to Contifico. */
export async function sendFacturaEmitida(params: {
  to: string;
  clienteNombre: string;
  numeroFactura: string;
  codigoCasillero?: string;
  pesoTotalLb: number;
  totalFlete: number;
  totalArancel: number;
  totalIva: number;
  totalGeneral: number;
  pdfUrl?: string;
  paquetes?: Array<{ referencia?: string; descripcion?: string; pesoLb?: number }>;
  portalUrl?: string;
}): Promise<EmailDeliveryResult> {
  const client = getClient();
  if (!client) return { success: false, error: "RESEND_API_KEY no configurado" };
  if (!params.to) return { success: false, error: "Cliente sin correo" };

  const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;

  const filas = (params.paquetes ?? [])
    .map(
      (p) => `
        <tr>
          <td style="padding:8px 10px; border-bottom:1px solid #2a2a2a; color:#f57c00; font-weight:bold;">${escapeEmailHtml(p.referencia)}</td>
          <td style="padding:8px 10px; border-bottom:1px solid #2a2a2a;">${escapeEmailHtml(p.descripcion)}</td>
          <td style="padding:8px 10px; border-bottom:1px solid #2a2a2a; text-align:right; color:#aaa;">${(Number(p.pesoLb) || 0).toFixed(2)} lb</td>
        </tr>`
    )
    .join("");

  const linea = (label: string, valor: string, destacado = false) => `
    <tr>
      <td style="padding:6px 0; color:${destacado ? "#fff" : "#999"}; font-size:${destacado ? "1rem" : "0.85rem"};">${label}</td>
      <td style="padding:6px 0; text-align:right; color:${destacado ? "#f57c00" : "#e0e0e0"}; font-weight:${destacado ? "bold" : "normal"}; font-size:${destacado ? "1.1rem" : "0.9rem"};">${valor}</td>
    </tr>`;

  try {
    const response = await client.emails.send({
      from: `Courier Box <${env.EMAIL_FROM}>`,
      to: params.to,
      subject: `Factura ${params.numeroFactura} · Courier Box`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background:#f57c00; padding:24px; border-radius:12px 12px 0 0;">
            <h1 style="color:#fff; margin:0; font-size:1.5rem;">Tu factura está lista</h1>
            <p style="color:rgba(255,255,255,0.85); margin:6px 0 0; font-size:0.85rem;">
              N° ${escapeEmailHtml(params.numeroFactura)}${params.codigoCasillero ? ` · Casillero ${escapeEmailHtml(params.codigoCasillero)}` : ""}
            </p>
          </div>
          <div style="background:#1a1a1a; color:#e0e0e0; padding:24px; border-radius:0 0 12px 12px;">
            <p>Hola <strong>${escapeEmailHtml(params.clienteNombre)}</strong>,</p>
            <p>Emitimos la factura electrónica de tus paquetes en bodega.</p>

            ${
              filas
                ? `<table style="width:100%; border-collapse:collapse; margin:18px 0; font-size:0.85rem;">
                     <thead><tr>
                       <th style="text-align:left; padding:8px 10px; color:#888; font-size:0.72rem; text-transform:uppercase; border-bottom:1px solid #333;">Referencia</th>
                       <th style="text-align:left; padding:8px 10px; color:#888; font-size:0.72rem; text-transform:uppercase; border-bottom:1px solid #333;">Descripción</th>
                       <th style="text-align:right; padding:8px 10px; color:#888; font-size:0.72rem; text-transform:uppercase; border-bottom:1px solid #333;">Peso</th>
                     </tr></thead>
                     <tbody>${filas}</tbody>
                   </table>`
                : ""
            }

            <table style="width:100%; border-collapse:collapse; margin:18px 0; padding:12px; background:#252525; border-radius:8px;">
              ${linea(`Flete (${(Number(params.pesoTotalLb) || 0).toFixed(2)} lb)`, money(params.totalFlete))}
              ${linea("Arancel", money(params.totalArancel))}
              ${linea("IVA", money(params.totalIva))}
              ${linea("Total a pagar", money(params.totalGeneral), true)}
            </table>

            ${
              params.pdfUrl
                ? `<div style="text-align:center; margin:20px 0;">
                     <a href="${safeEmailUrl(params.pdfUrl)}" style="background:#f57c00; color:#fff; padding:12px 28px; border-radius:8px; text-decoration:none; font-weight:bold; display:inline-block;">
                       Descargar factura (PDF)
                     </a>
                   </div>`
                : ""
            }

            ${
              params.portalUrl
                ? `<div style="text-align:center; margin:12px 0;">
                     <a href="${safeEmailUrl(params.portalUrl)}" style="border:1px solid #f57c00; color:#f57c00; padding:11px 24px; border-radius:8px; text-decoration:none; font-weight:bold; display:inline-block;">
                       Pagar y coordinar retiro
                     </a>
                   </div>`
                : ""
            }

            <div style="text-align:center; margin:16px 0 4px;">
              <a href="${safeEmailUrl(
                whatsappLink(
                  `Hola Courier Box, soy ${params.clienteNombre}. Tengo una consulta sobre la factura ${params.numeroFactura}.`
                )
              )}" style="background:#25D366; color:#fff; padding:11px 24px; border-radius:8px; text-decoration:none; font-weight:bold; display:inline-block;">
                Escríbenos por WhatsApp
              </a>
              <p style="color:#777; font-size:0.72rem; margin:8px 0 0;">${WHATSAPP_DISPLAY}</p>
            </div>

            <p style="color:#666; font-size:0.8rem; margin-top:24px;">Courier Box Logistics · courierboxlogistics.com</p>
          </div>
        </div>
      `,
    });
    if (response.error) return { success: false, error: response.error.message };
    console.log(`[email] factura ${params.numeroFactura} sent to ${params.to}`);
    return { success: true, providerId: response.data?.id };
  } catch (err) {
    console.error("[email] failed to send factura:", err);
    return { success: false, error: emailError(err) };
  }
}

/**
 * Counter pickup receipt. Replaces the paper slip the client used to sign:
 * they get the signed PDF plus the itemised list of what they took.
 */
export async function sendRetiroCounterComprobante(params: {
  to: string;
  clienteNombre: string;
  folio: string;
  totalPaquetes: number;
  totalPesoLb: number;
  totalValor: number;
  comprobanteUrl?: string;
  firmaUrl?: string;
  retiradoPor?: string;
  items?: Array<{ referencia?: string; descripcion?: string; pesoLb?: number }>;
  portalUrl?: string;
}): Promise<EmailDeliveryResult> {
  const client = getClient();
  if (!client) return { success: false, error: "RESEND_API_KEY no configurado" };
  if (!params.to) return { success: false, error: "Cliente sin correo" };

  const fecha = new Date().toLocaleString("es-EC", { dateStyle: "long", timeStyle: "short" });

  const itemsHtml = (params.items ?? [])
    .map(
      (item) => `
        <tr>
          <td style="padding:8px 10px; border-bottom:1px solid #2a2a2a; color:#f57c00; font-weight:bold;">${escapeEmailHtml(item.referencia)}</td>
          <td style="padding:8px 10px; border-bottom:1px solid #2a2a2a;">${escapeEmailHtml(item.descripcion)}</td>
          <td style="padding:8px 10px; border-bottom:1px solid #2a2a2a; text-align:right; color:#aaa;">${(Number(item.pesoLb) || 0).toFixed(2)} lb</td>
        </tr>`
    )
    .join("");

  const comprobanteBoton = params.comprobanteUrl
    ? `<div style="text-align:center; margin:24px 0;">
         <a href="${safeEmailUrl(params.comprobanteUrl)}" style="background:#f57c00; color:#fff; padding:12px 28px; border-radius:8px; text-decoration:none; font-weight:bold; display:inline-block;">
           Descargar comprobante firmado (PDF)
         </a>
       </div>`
    : "";

  // No CRM: the client reaches us by opening a prefilled chat on our own line.
  const whatsappBoton = `
    <div style="text-align:center; margin:16px 0 4px;">
      <a href="${safeEmailUrl(
        whatsappLink(
          `Hola Courier Box, soy ${params.clienteNombre}. Tengo una consulta sobre mi retiro #${params.folio}.`
        )
      )}" style="background:#25D366; color:#fff; padding:11px 24px; border-radius:8px; text-decoration:none; font-weight:bold; display:inline-block;">
        Escríbenos por WhatsApp
      </a>
      <p style="color:#777; font-size:0.72rem; margin:8px 0 0;">${WHATSAPP_DISPLAY}</p>
    </div>`;

  const firmaHtml = params.firmaUrl
    ? `<div style="margin:16px 0; text-align:center;">
         <p style="color:#999; font-size:0.8rem; margin:0 0 6px;">Firma registrada</p>
         <img src="${safeEmailUrl(params.firmaUrl)}" alt="Firma" style="max-width:240px; background:#fff; border-radius:8px; border:1px solid #333; padding:4px;" />
       </div>`
    : "";

  try {
    const response = await client.emails.send({
      from: `Courier Box <${env.EMAIL_FROM}>`,
      to: params.to,
      subject: `Comprobante de retiro #${params.folio} · Courier Box`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #f57c00; padding: 24px; border-radius: 12px 12px 0 0;">
            <h1 style="color:#fff; margin:0; font-size:1.5rem;">Retiro confirmado</h1>
            <p style="color:rgba(255,255,255,0.85); margin:6px 0 0; font-size:0.85rem;">Folio #${escapeEmailHtml(params.folio)} · ${escapeEmailHtml(fecha)}</p>
          </div>
          <div style="background:#1a1a1a; color:#e0e0e0; padding:24px; border-radius:0 0 12px 12px;">
            <p>Hola <strong>${escapeEmailHtml(params.clienteNombre)}</strong>,</p>
            <p>Confirmamos la entrega de <strong>${params.totalPaquetes}</strong> paquete(s) en nuestro counter${
              params.retiradoPor && params.retiradoPor !== params.clienteNombre
                ? `, retirados por <strong>${escapeEmailHtml(params.retiradoPor)}</strong>`
                : ""
            }.</p>

            <table style="width:100%; border-collapse:collapse; margin:18px 0; font-size:0.85rem;">
              <thead>
                <tr>
                  <th style="text-align:left; padding:8px 10px; color:#888; font-size:0.72rem; text-transform:uppercase; letter-spacing:0.06em; border-bottom:1px solid #333;">Referencia</th>
                  <th style="text-align:left; padding:8px 10px; color:#888; font-size:0.72rem; text-transform:uppercase; letter-spacing:0.06em; border-bottom:1px solid #333;">Descripción</th>
                  <th style="text-align:right; padding:8px 10px; color:#888; font-size:0.72rem; text-transform:uppercase; letter-spacing:0.06em; border-bottom:1px solid #333;">Peso</th>
                </tr>
              </thead>
              <tbody>${itemsHtml}</tbody>
            </table>

            <div style="padding:12px 16px; background:#252525; border-radius:8px; border-left:3px solid #f57c00;">
              <span style="color:#999; font-size:0.8rem;">Peso total</span>
              <strong style="color:#f57c00; font-size:1.05rem; display:block;">${(Number(params.totalPesoLb) || 0).toFixed(2)} lb</strong>
            </div>

            ${comprobanteBoton}
            ${whatsappBoton}
            ${firmaHtml}

            <p style="color:#666; font-size:0.8rem; margin-top:24px;">
              Guarda este correo como respaldo de tu retiro. Courier Box Logistics · courierboxlogistics.com
            </p>
          </div>
        </div>
      `,
    });
    if (response.error) return { success: false, error: response.error.message };
    console.log(`[email] retiro counter sent to ${params.to}`);
    return { success: true, providerId: response.data?.id };
  } catch (err) {
    console.error("[email] failed to send retiro counter:", err);
    return { success: false, error: emailError(err) };
  }
}

interface VentaProductoEmailData {
  vendedorNombre: string;
  clienteNombre: string;
  productoNombre: string;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
  valorEnvio: number;
  total: number;
  metodoEntrega: string;
  metodoPago: string;
  pagoConfirmado: boolean;
  esCredito: boolean;
  abono: number;
  saldo: number;
  cuotas: { fecha: Date; monto: number }[];
  observacion: string;
  /** Internal figures — included in the admin mail only. */
  costoTotal?: number;
  comisionTotal?: number;
}

function ventaRow(label: string, value: string, alt = false): string {
  return `<tr style="background:${alt ? "#252525" : "transparent"}"><td style="padding:8px;color:#999;width:170px">${escapeEmailHtml(label)}</td><td style="padding:8px"><strong>${escapeEmailHtml(value)}</strong></td></tr>`;
}

function cuotasHtml(cuotas: { fecha: Date; monto: number }[]): string {
  if (!cuotas.length) return "";
  const rows = cuotas
    .map(
      (c) =>
        `<tr><td style="padding:6px 8px;color:#ccc">${new Date(c.fecha).toLocaleDateString("es-EC")}</td><td style="padding:6px 8px;text-align:right"><strong>$${(Number(c.monto) || 0).toFixed(2)}</strong></td></tr>`
    )
    .join("");
  return `<h3 style="color:#f57c00;margin:16px 0 8px">Plan de pago a crédito</h3><table style="width:100%;border-collapse:collapse;background:#1f1b17;border-radius:8px">${rows}</table>`;
}

const entregaLabel = (m: string) => (m === "envio" ? "Envío a domicilio" : "Retiro en oficina");

/** Full sale detail for the admin, cost and commission included. */
export async function sendVentaProductoAdmin(data: VentaProductoEmailData): Promise<EmailDeliveryResult> {
  const client = getClient();
  if (!client) return { success: false, error: "RESEND_API_KEY no configurado" };
  try {
    const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;
    const rows =
      ventaRow("Vendedor", data.vendedorNombre) +
      ventaRow("Cliente", data.clienteNombre, true) +
      ventaRow("Producto", `${data.productoNombre} × ${data.cantidad}`) +
      ventaRow("Precio unitario", money(data.precioUnitario), true) +
      ventaRow("Subtotal", money(data.subtotal)) +
      ventaRow("Entrega", entregaLabel(data.metodoEntrega), true) +
      ventaRow("Valor de envío", money(data.valorEnvio)) +
      ventaRow("Método de pago", `${data.metodoPago}${data.pagoConfirmado ? " (confirmado)" : " (pendiente)"}`, true) +
      (data.esCredito ? ventaRow("Abono / Saldo", `${money(data.abono)} / ${money(data.saldo)}`) : "") +
      ventaRow("Costo total", money(data.costoTotal || 0), true) +
      ventaRow("Comisión total", money(data.comisionTotal || 0)) +
      ventaRow("TOTAL", money(data.total), true) +
      (data.observacion ? ventaRow("Observación", data.observacion) : "");
    const response = await client.emails.send({
      from: `Courier Box <${env.EMAIL_FROM}>`,
      to: env.ADMIN_EMAIL,
      subject: `Nueva venta de producto — ${data.clienteNombre} (${money(data.total)})`,
      html: `<div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto"><div style="background:#f57c00;padding:20px;border-radius:12px 12px 0 0"><h1 style="color:#fff;margin:0;font-size:1.35rem">Venta de producto registrada</h1></div><div style="background:#1a1a1a;color:#e0e0e0;padding:24px;border-radius:0 0 12px 12px"><table style="width:100%;border-collapse:collapse;margin-bottom:8px">${rows}</table>${cuotasHtml(data.cuotas)}</div></div>`,
    });
    if (response.error) return { success: false, error: response.error.message };
    return { success: true, providerId: response.data?.id };
  } catch (err) {
    return { success: false, error: emailError(err) };
  }
}

/** Client-facing summary. Cost and commission are intentionally omitted. */
export async function sendVentaProductoCliente(
  to: string,
  data: VentaProductoEmailData
): Promise<EmailDeliveryResult> {
  const client = getClient();
  if (!client) return { success: false, error: "RESEND_API_KEY no configurado" };
  try {
    const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;
    const rows =
      ventaRow("Producto", `${data.productoNombre} × ${data.cantidad}`) +
      ventaRow("Precio unitario", money(data.precioUnitario), true) +
      ventaRow("Subtotal", money(data.subtotal)) +
      ventaRow("Entrega", entregaLabel(data.metodoEntrega), true) +
      ventaRow("Valor de envío", money(data.valorEnvio)) +
      ventaRow("Método de pago", data.metodoPago, true) +
      (data.esCredito ? ventaRow("Abono / Saldo pendiente", `${money(data.abono)} / ${money(data.saldo)}`) : "") +
      ventaRow("TOTAL", money(data.total), true);
    const response = await client.emails.send({
      from: `Courier Box <${env.EMAIL_FROM}>`,
      to,
      subject: "Resumen de tu compra — Courier Box",
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><div style="background:#f57c00;padding:20px;border-radius:12px 12px 0 0"><h1 style="color:#fff;margin:0;font-size:1.35rem">Gracias por tu compra</h1></div><div style="background:#1a1a1a;color:#e0e0e0;padding:24px;border-radius:0 0 12px 12px"><p>Hola <strong>${escapeEmailHtml(data.clienteNombre)}</strong>, este es el resumen de tu compra:</p><table style="width:100%;border-collapse:collapse;margin-bottom:8px">${rows}</table>${cuotasHtml(data.cuotas)}<p style="color:#999;font-size:.85rem;margin-top:16px">Si tienes dudas, contáctanos.</p></div></div>`,
    });
    if (response.error) return { success: false, error: response.error.message };
    return { success: true, providerId: response.data?.id };
  } catch (err) {
    return { success: false, error: emailError(err) };
  }
}
