import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

export interface GenerateLinkPayload {
  amount: number;
  amountWithoutTax: number;
  amountWithTax: number;
  tax: number;
  service?: number;
  tip?: number;
  currency?: string;
  reference: string;
  clientTransactionId: string;
  additionalData?: string;
  oneTime?: boolean;
  expireIn?: number;
  isAmountEditable?: boolean;
}

export class PayphoneService {
  private readonly apiUrl = "https://pay.payphonetodoesposible.com/api/Links";

  async generateLink(payload: GenerateLinkPayload): Promise<string> {
    try {
      const data = {
        ...payload,
        currency: payload.currency || "USD",
        storeId: env.PAYPHONE_STORE_ID,
      };

      const response = await fetch(this.apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.PAYPHONE_TOKEN.trim()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch (e) {
          errorData = errorText; // fallback to text if not json
        }
        logger.error("[payphone.service] API Error", errorData);
        throw new Error(`Payphone API Error: ${response.status} ${response.statusText}`);
      }

      const link = await response.text();
      // The API returns the plain text link, but sometimes it returns JSON with quotes.
      // So we handle parsing it correctly:
      try {
        const parsed = JSON.parse(link);
        if (typeof parsed === "string") {
          return parsed;
        }
        return link; // If it's an object somehow, though docs say string
      } catch (e) {
        return link; // It's a plain string like https://payp.page.link/abc
      }
    } catch (error) {
      logger.error("[payphone.service] Exception", { error: String(error) });
      throw error;
    }
  }
}

export const payphoneService = new PayphoneService();
