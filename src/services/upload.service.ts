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
  resourceType: string;
}

export interface CloudinaryAssetRef {
  publicId: string;
  resourceType: string;
}

async function uploadBuffer(buffer: Buffer, folder: string): Promise<UploadResult> {
  if (!isCloudinaryEnabled()) {
    logger.warn("[upload] Cloudinary no configurado — simulando subida");
    return { url: "", publicId: `sim-${Date.now()}`, resourceType: "" };
  }

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "auto" },
      (err, result) => {
        if (err || !result) {
          const message = toErrorMessage(err);
          if (message.includes('cloud_name is disabled')) {
            logger.warn('[upload] Cloudinary disabled at runtime — simulating upload');
            resolve({ url: '', publicId: `sim-${Date.now()}`, resourceType: '' });
            return;
          }
          reject(new Error(message || "Upload failed"));
          return;
        }
        resolve({ url: result.secure_url, publicId: result.public_id, resourceType: result.resource_type || '' });
      }
    );
    stream.end(buffer);
  });
}

export function extractCloudinaryAssetRef(url: string): CloudinaryAssetRef | null {
  if (!url) return null;

  const match = url.match(/\/(image|raw|video)\/upload\/(?:v\d+\/)?(.+?)(?:\.[^./?#]+)?(?:[?#].*)?$/i);
  if (!match) return null;

  return {
    resourceType: match[1].toLowerCase(),
    publicId: match[2],
  };
}

export async function deleteCloudinaryAsset(asset: CloudinaryAssetRef): Promise<void> {
  if (!isCloudinaryEnabled()) {
    logger.warn('[upload] Cloudinary no configurado — omitiendo borrado');
    return;
  }

  const resourceTypes = asset.resourceType ? [asset.resourceType] : ['image', 'raw', 'video'];

  for (const resourceType of resourceTypes) {
    try {
      const result = await cloudinary.uploader.destroy(asset.publicId, { resource_type: resourceType, invalidate: true });
      if (result === 'ok' || (typeof result === 'object' && result && 'result' in result && (result as { result?: string }).result === 'ok')) {
        return;
      }
    } catch (error) {
      logger.warn('[upload] No se pudo borrar asset de Cloudinary', { publicId: asset.publicId, resourceType, error });
    }
  }
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

export async function uploadGestionCompraImagen(buffer: Buffer): Promise<UploadResult> {
  return uploadBuffer(buffer, "courierbox/gestiones_compra");
}
