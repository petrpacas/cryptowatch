import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseSecretKey, jsonResponse } from "../_shared/supabase.ts";
import { isWorkerAuthorized } from "../_shared/worker-auth.ts";
import {
  type NotificationDelivery,
  runNotificationWorker,
  sendWithResend,
} from "./notifications.ts";

function asDelivery(value: Record<string, unknown>): NotificationDelivery {
  return {
    messageId: Number(value.message_id),
    eventId: String(value.event_id),
    recipientEmail: String(value.recipient_email),
    coinName: String(value.coin_name),
    coinSymbol: String(value.coin_symbol),
    direction: value.direction === "below" ? "below" : "above",
    thresholdUsd: String(value.threshold_usd),
    triggerPriceUsd: String(value.trigger_price_usd),
    deliveryAttempt: Number(value.delivery_attempt),
  };
}

function databaseDependencies(supabase: SupabaseClient) {
  return {
    async claimDeliveries(): Promise<NotificationDelivery[]> {
      const { data, error } = await supabase.rpc("claim_notification_deliveries");
      if (error) throw error;
      return (data ?? []).map((value: Record<string, unknown>) => asDelivery(value));
    },

    async completeDelivery(delivery: NotificationDelivery, resendEmailId: string) {
      const { data, error } = await supabase.rpc("complete_notification_delivery", {
        p_event_id: delivery.eventId,
        p_message_id: delivery.messageId,
        p_resend_email_id: resendEmailId,
      });
      if (error) throw error;
      if (!data) throw new Error("The queue message could not be completed");
    },

    async failDelivery(
      delivery: NotificationDelivery,
      message: string,
      retryable: boolean,
    ): Promise<"pending" | "failed" | "sent" | "missing"> {
      const { data, error } = await supabase.rpc("fail_notification_delivery", {
        p_event_id: delivery.eventId,
        p_message_id: delivery.messageId,
        p_error: message,
        p_retryable: retryable,
      });
      if (error) throw error;
      if (!["pending", "failed", "sent", "missing"].includes(data)) {
        throw new Error("Database returned an invalid delivery status");
      }
      return data;
    },
  };
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const workerSecret = Deno.env.get("WORKER_SECRET");
  if (!isWorkerAuthorized(request, workerSecret)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseSecretKey = getSupabaseSecretKey();
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const resendFrom = Deno.env.get("RESEND_FROM");
  if (!supabaseUrl || !supabaseSecretKey || !resendApiKey || !resendFrom) {
    return jsonResponse({ error: "The function is missing required secrets" }, 500);
  }

  const supabase = createClient(supabaseUrl, supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const database = databaseDependencies(supabase);

  try {
    const result = await runNotificationWorker({
      ...database,
      sendEmail: (delivery) =>
        sendWithResend(delivery, resendApiKey, resendFrom),
    });
    return jsonResponse(result, result.errors.length > 0 ? 207 : 200);
  } catch (error) {
    console.error("Notification worker failed", error);
    return jsonResponse(
      {
        error: "Notification worker failed",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});
