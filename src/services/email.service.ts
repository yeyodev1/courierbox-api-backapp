import { Resend } from "resend";
import { env } from "../config/env.js";

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
