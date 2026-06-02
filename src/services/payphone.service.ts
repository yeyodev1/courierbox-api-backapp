import 'dotenv/config';
import axios, { AxiosError } from 'axios';

const PAYPHONE_LINKS_URL = 'https://pay.payphonetodoesposible.com/api/Links';

function getToken() {
  const t = process.env.PAYPHONE_TOKEN;
  if (!t) throw new Error('PAYPHONE_TOKEN env var is not set');
  return t;
}
function getStoreId() {
  const s = process.env.PAYPHONE_STORE_ID;
  if (!s) throw new Error('PAYPHONE_STORE_ID env var is not set');
  return s;
}

function authHeaders() {
  return {
    Authorization: `Bearer ${getToken()}`,
    'Content-Type': 'application/json',
  };
}

function logErr(ctx: string, error: unknown) {
  if (error instanceof AxiosError) {
    console.error(`[PayphoneLinks] ${ctx} failed:`, {
      status: error.response?.status,
      data: JSON.stringify(error.response?.data),
      payload: JSON.stringify(error.config?.data),
    });
  } else {
    console.error(`[PayphoneLinks] ${ctx} error:`, error);
  }
}

export interface CreatePaymentLinkParams {
  amountCents: number;
  taxCents: number;
  amountWithoutTaxCents: number;
  reference: string;
  clientTransactionId: string;
  expireInHours?: number;
}

export interface CreatePaymentLinkResult {
  paymentLink: string;
  expiresAt: Date;
}

export const payphoneLinksService = {
  async createPaymentLink(params: CreatePaymentLinkParams): Promise<CreatePaymentLinkResult> {
    if (params.clientTransactionId.length > 15) {
      throw new Error(`clientTransactionId must be ≤15 chars, got ${params.clientTransactionId.length}`);
    }
    const sumCheck = params.amountWithoutTaxCents + params.taxCents;
    if (sumCheck !== params.amountCents) {
      throw new Error(`Payphone sum mismatch: amountWithoutTax(${params.amountWithoutTaxCents}) + tax(${params.taxCents}) != amount(${params.amountCents})`);
    }

    const expireInHours = params.expireInHours ?? 24;

    const payload: Record<string, unknown> = {
      amount: params.amountCents,
      amountWithTax: 0,
      amountWithoutTax: params.amountWithoutTaxCents,
      tax: params.taxCents,
      service: 0,
      tip: 0,
      currency: 'USD',
      clientTransactionId: params.clientTransactionId,
      storeId: getStoreId(),
      reference: params.reference.slice(0, 100),
      oneTime: true,
      expireIn: expireInHours,
    };

    console.log('[PayphoneLinks] payload:', JSON.stringify(payload));

    try {
      const response = await axios.post(PAYPHONE_LINKS_URL, payload, {
        headers: authHeaders(),
        responseType: 'text',
        transformResponse: [(data) => data],
      });
      const raw = typeof response.data === 'string' ? response.data.trim() : String(response.data);
      const paymentLink = raw.replace(/^"|"$/g, '');
      console.log('[PayphoneLinks] response link:', paymentLink);

      if (!/^https?:\/\//.test(paymentLink)) {
        throw new Error(`Payphone returned unexpected response: ${raw}`);
      }

      const expiresAt = new Date(Date.now() + expireInHours * 60 * 60 * 1000);
      return { paymentLink, expiresAt };
    } catch (error) {
      logErr('Links create', error);
      throw error;
    }
  },
};