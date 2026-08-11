import { env } from "./env";

/**
 * Courier Box's own WhatsApp line. Mirrors
 * `courierbox-webpage-frontapp/src/config/contact.ts` — keep both in sync.
 *
 * There is no CRM and no WhatsApp Business API in this stack, so the backend
 * never *sends* a WhatsApp message. It composes the text and builds a
 * click-to-chat link pointing at this number; a human opens it.
 */
export const WHATSAPP_NUMBER_RAW = String(env.COURIER_WHATSAPP_NUMBER || "13478248937").replace(
  /\D/g,
  ""
);

export const WHATSAPP_DISPLAY = "+1 347 824 8937";

export function whatsappLink(text?: string): string {
  const base = `https://wa.me/${WHATSAPP_NUMBER_RAW}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}
