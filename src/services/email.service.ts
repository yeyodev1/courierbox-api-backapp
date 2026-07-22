import { Resend } from "resend";
import { env } from "../config/env";

let resend: Resend | null = null;

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
}): Promise<void> {
  const client = getClient();
  if (!client) return;

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
    await client.emails.send({
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
    console.log(`[email] gestion compra confirmation sent to ${params.to}`);
  } catch (err) {
    console.error("[email] failed to send gestion compra confirmation:", err);
  }
}

export async function sendRecepcionBodegaCliente(params: {
  to: string;
  clientName: string;
  fotos: string[];
  viewUrl: string;
  asesorNombre?: string;
  notas?: string;
}): Promise<void> {
  const client = getClient();
  if (!client) return;

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
    await client.emails.send({
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
    console.log(`[email] recepcion bodega sent to ${params.to}`);
  } catch (err) {
    console.error("[email] failed to send recepcion bodega:", err);
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
}): Promise<void> {
  const client = getClient();
  if (!client) return;

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
    await client.emails.send({
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
    console.log(`[email] envio en camino sent to ${params.to}`);
  } catch (err) {
    console.error("[email] failed to send envio en camino:", err);
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
}): Promise<void> {
  const client = getClient();
  if (!client) return;

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
    await client.emails.send({
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
                       <td style="padding: 8px;"><strong>${params.recibidoPor}${params.recibidoPorCedula ? ` · CI ${params.recibidoPorCedula}` : ""}</strong></td>
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
    console.log(`[email] entrega confirmation sent to ${params.to}`);
  } catch (err) {
    console.error("[email] failed to send entrega confirmation:", err);
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
