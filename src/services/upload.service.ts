import { v2 as cloudinary, type UploadApiResponse } from "cloudinary";
import { env } from "../config/env";
import { logger } from "../utils/logger";

function toErrorMessage(err: unknown) {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const anyErr = err as Record<string, unknown>;
    if (typeof anyErr.message === "string" && anyErr.message.trim()) return anyErr.message;
    if (typeof anyErr.error === "string" && anyErr.error.trim()) return anyErr.error;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

function isCloudinaryEnabled() {
  const cloudName = String(env.CLOUDINARY_CLOUD_NAME || '').trim().toLowerCase();
  const apiKey = String(env.CLOUDINARY_API_KEY || '').trim();
  const apiSecret = String(env.CLOUDINARY_API_SECRET || '').trim();
  if (!cloudName || cloudName === 'disabled' || cloudName === 'false' || cloudName === 'off') return false;
  return Boolean(apiKey && apiSecret);
}

if (isCloudinaryEnabled()) {
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
  });
}

export interface UploadResult {
  url: string;
  publicId: string;
}

async function uploadBuffer(buffer: Buffer, folder: string): Promise<UploadResult> {
  if (!isCloudinaryEnabled()) {
    logger.warn("[upload] Cloudinary no configurado — simulando subida");
    return { url: "", publicId: `sim-${Date.now()}` };
  }

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "auto" },
      (err, result) => {
        if (err || !result) {
          const message = toErrorMessage(err);
          if (message.includes('cloud_name is disabled')) {
            logger.warn('[upload] Cloudinary disabled at runtime — simulating upload');
            resolve({ url: '', publicId: `sim-${Date.now()}` });
            return;
          }
          reject(new Error(message || "Upload failed"));
          return;
        }
        resolve({ url: result.secure_url, publicId: result.public_id });
      }
    );
    stream.end(buffer);
  });
}

export async function uploadComprobante(buffer: Buffer): Promise<UploadResult> {
  return uploadBuffer(buffer, "courierbox/comprobantes");
}

export async function uploadTransferProof(buffer: Buffer): Promise<UploadResult> {
  return uploadBuffer(buffer, "courierbox/transferencias");
}

export async function uploadExcel(buffer: Buffer): Promise<UploadResult> {
  return uploadBuffer(buffer, "courierbox/etl");
}

export async function uploadEnvioEvidencia(buffer: Buffer): Promise<UploadResult> {
  return uploadBuffer(buffer, "courierbox/envios/evidencias");
}

export async function uploadEnvioGuia(buffer: Buffer): Promise<UploadResult> {
  return uploadBuffer(buffer, "courierbox/envios/guias");
}

export async function uploadGastoFactura(buffer: Buffer): Promise<UploadResult> {
  return uploadBuffer(buffer, "courierbox/gastos/facturas");
}
