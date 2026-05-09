import { z } from "zod";

export const trackingParams = z.object({
  codigo: z
    .string()
    .min(3, "código demasiado corto")
    .max(40, "código demasiado largo")
    .regex(/^[A-Za-z0-9-]+$/, "código contiene caracteres inválidos"),
});
