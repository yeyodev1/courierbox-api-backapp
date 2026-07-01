import axios from "axios";
import { env } from "../config/env";

export class GHLService {
  private static baseURL = "https://services.leadconnectorhq.com";

  private static get headers() {
    return {
      Authorization: `Bearer ${env.GHL_ACCESS_TOKEN}`,
      Version: "2021-07-28",
      Accept: "application/json",
    };
  }

  /**
   * Retrieves users (agents) from Go High Level
   */
  static async getUsers(locationId: string) {
    try {
      const { data } = await axios.get(`${this.baseURL}/users/`, {
        headers: this.headers,
        params: { locationId },
      });
      return data;
    } catch (error) {
      console.error("[GHLService] Error fetching users:", error);
      throw error;
    }
  }

  /**
   * Retrieves conversation metrics from Go High Level
   */
  static async getConversationsSearch(locationId: string, limit: number = 20) {
    try {
      const { data } = await axios.get(`${this.baseURL}/conversations/search`, {
        headers: this.headers,
        params: { locationId, limit },
      });
      return data;
    } catch (error) {
      console.error("[GHLService] Error fetching conversations:", error);
      throw error;
    }
  }

  /**
   * Retrieves messages for a specific conversation
   */
  static async getConversationMessages(conversationId: string, limit: number = 20) {
    try {
      const { data } = await axios.get(`${this.baseURL}/conversations/${conversationId}/messages`, {
        headers: this.headers,
        params: { limit },
      });
      return data;
    } catch (error: any) {
      if (error.response?.status === 401) {
        // Silenciar stack trace masivo de 401 para pit- tokens que GHL bloquea
        console.warn(`[GHLService] No autorizado para leer mensajes de la conv ${conversationId}.`);
      } else {
        console.error(`[GHLService] Error fetching messages for conversation ${conversationId}:`, error.message);
      }
      throw error;
    }
  }
}
