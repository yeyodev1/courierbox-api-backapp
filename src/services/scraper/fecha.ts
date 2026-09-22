/**
 * Fechas del sistema de tmalogistics.
 *
 * El sistema mezcla dos formatos en la misma tabla de historial:
 *   - Filas cargadas por bodega, con AM/PM:      "09/16/2026 11:29 AM"  → MM/DD
 *   - Filas automáticas, 24h con segundos:        "11/09/2026 19:07:37"  → DD/MM
 * Si un componente es > 12 manda él; si no, AM/PM ⇒ MM/DD y 24h ⇒ DD/MM.
 * Como red de seguridad, una fecha que cae en el futuro se prueba invertida.
 *
 * La hora es de pared (sin zona); se ancla a Ecuador (UTC-5, sin horario de
 * verano) para que el cliente vea la misma hora que muestra el sistema.
 */
const OFFSET_ECUADOR = "-05:00";
const TOLERANCIA_FUTURO_MS = 24 * 60 * 60 * 1000;

function construir(y: string, mo: number, d: number, hh: number, mm: number, ss: number): Date | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const p2 = (n: number) => String(n).padStart(2, "0");
  const dt = new Date(`${y}-${p2(mo)}-${p2(d)}T${p2(hh)}:${p2(mm)}:${p2(ss)}${OFFSET_ECUADOR}`);
  if (Number.isNaN(dt.getTime())) return null;
  // Descarta desbordes tipo 31/02 que Date "corrige" al mes siguiente.
  const local = new Date(dt.getTime() - 5 * 60 * 60 * 1000);
  if (local.getUTCMonth() + 1 !== mo || local.getUTCDate() !== d) return null;
  return dt;
}

export function parseFecha(raw: string | null | undefined, ahora: Date = new Date()): string | null {
  if (!raw) return null;
  const t = raw.trim();
  const m = t.match(
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?\s*m\.?)?)?/i
  );
  if (m && m[1] && m[2] && m[3]) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    let hh = m[4] ? Number(m[4]) : 0;
    const mm = m[5] ? Number(m[5]) : 0;
    const ss = m[6] ? Number(m[6]) : 0;
    const ampm = (m[7] || "").toLowerCase().replace(/[.\s]/g, "");
    if (ampm === "pm" && hh < 12) hh += 12;
    if (ampm === "am" && hh === 12) hh = 0;

    let mesPrimero: boolean;
    if (a > 12) mesPrimero = false;
    else if (b > 12) mesPrimero = true;
    else mesPrimero = ampm !== "";

    const principal = mesPrimero ? construir(y, a, b, hh, mm, ss) : construir(y, b, a, hh, mm, ss);
    const alterna = a === b ? null : mesPrimero ? construir(y, b, a, hh, mm, ss) : construir(y, a, b, hh, mm, ss);
    const limite = ahora.getTime() + TOLERANCIA_FUTURO_MS;

    if (principal && principal.getTime() > limite && alterna && alterna.getTime() <= limite) {
      return alterna.toISOString();
    }
    if (principal) return principal.toISOString();
    if (alterna) return alterna.toISOString();
  }
  const iso = Date.parse(t);
  if (!Number.isNaN(iso)) return new Date(iso).toISOString();
  return null;
}
