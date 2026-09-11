import { APP_URL, emailLayout, escapeHtml } from "../_shared/email-layout.ts";

export type NotificationDirection = "above" | "below";

export type NotificationDelivery = {
  messageId: number;
  eventId: string;
  recipientEmail: string;
  coinName: string;
  coinSymbol: string;
  direction: NotificationDirection;
  thresholdUsd: string;
  triggerPriceUsd: string;
  deliveryAttempt: number;
};

export type SendResult = { id: string };

export type NotificationWorkerDependencies = {
  claimDeliveries: () => Promise<NotificationDelivery[]>;
  sendEmail: (delivery: NotificationDelivery) => Promise<SendResult>;
  completeDelivery: (
    delivery: NotificationDelivery,
    resendEmailId: string,
  ) => Promise<void>;
  failDelivery: (
    delivery: NotificationDelivery,
    message: string,
    retryable: boolean,
  ) => Promise<"pending" | "failed" | "sent" | "missing">;
};

export type NotificationWorkerResult = {
  claimed: number;
  sent: number;
  retrying: number;
  failed: number;
  errors: string[];
};

export class DeliveryError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = "DeliveryError";
  }
}

function displayPrice(value: string): string {
  const price = Number(value);
  if (!Number.isFinite(price) || price <= 0) return `$${value}`;

  return new Intl.NumberFormat("cs-CZ", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: price < 1 ? 8 : 2,
  }).format(price);
}

export function notificationIdempotencyKey(eventId: string): string {
  return `cryptowatch/notification/${eventId}`;
}

export function createEmailPayload(
  delivery: NotificationDelivery,
  from: string,
): { from: string; to: string[]; subject: string; text: string; html: string } {
  const symbol = delivery.coinSymbol.toUpperCase();
  const direction = delivery.direction === "above" ? "nad" : "pod";
  const threshold = displayPrice(delivery.thresholdUsd);
  const triggerPrice = displayPrice(delivery.triggerPriceUsd);
  const subject = `${symbol} je ${direction} hranicí ${threshold}`;
  const text = [
    `CryptoWatch zachytil cenu měny ${delivery.coinName} (${symbol}).`,
    `Aktuální cena: ${triggerPrice}`,
    `Nastavená podmínka: ${direction} ${threshold}`,
    "Alert byl po splnění podmínky automaticky vypnut. V aplikaci jej můžeš znovu zapnout nebo upravit.",
    `Otevřít moje sledování: ${APP_URL}`,
  ].join("\n");

  return {
    from,
    to: [delivery.recipientEmail],
    subject,
    text,
    html: emailLayout({
      preview: `${delivery.coinName}: ${triggerPrice}. Cena je ${direction} hranicí ${threshold}.`,
      eyebrow: "Cenové upozornění",
      title: `${symbol} je ${direction} tvým limitem.`,
      body: `<p style="margin:0 0 24px;color:#b3c7be;font-size:16px;line-height:1.7;">Měna <strong style="color:#f3fbf7;">${escapeHtml(delivery.coinName)} (${escapeHtml(symbol)})</strong> splnila nastavenou podmínku.</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-top:1px solid #385348;border-bottom:1px solid #385348;">
            <tr><td style="padding:20px 0 6px;color:#b3c7be;font-size:14px;">Zachycená cena</td></tr>
            <tr><td style="padding:0 0 16px;color:#82f5c9;font-size:30px;font-weight:700;line-height:1.3;">${escapeHtml(triggerPrice)}</td></tr>
            <tr><td style="padding:0 0 20px;color:#b3c7be;font-size:16px;line-height:1.6;">Tvůj limit: <strong style="color:#f3fbf7;">${direction} ${escapeHtml(threshold)}</strong></td></tr>
          </table>
          <p style="margin:24px 0 0;color:#b3c7be;font-size:16px;line-height:1.7;">Alert se po splnění podmínky automaticky vypnul. V aplikaci jej můžeš znovu zapnout nebo upravit.</p>`,
      actionLabel: "Otevřít moje sledování",
      actionUrl: APP_URL,
      footer: "Tento e-mail dostáváš na základě svého cenového alertu v CryptoWatch. Cenová data poskytuje CoinGecko. Aktuální cena se už mohla změnit.",
    }),
  };
}

function errorDetails(payload: unknown): { name?: string; message?: string } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const value = payload as Record<string, unknown>;
  return {
    name: typeof value.name === "string" ? value.name : undefined,
    message: typeof value.message === "string" ? value.message : undefined,
  };
}

export async function sendWithResend(
  delivery: NotificationDelivery,
  apiKey: string,
  from: string,
  fetcher: typeof fetch = fetch,
): Promise<SendResult> {
  let response: Response;
  try {
    response = await fetcher("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "idempotency-key": notificationIdempotencyKey(delivery.eventId),
        "user-agent": "cryptowatch/1.0",
      },
      body: JSON.stringify(createEmailPayload(delivery, from)),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new DeliveryError(
      error instanceof Error ? error.message : "Resend request failed",
      true,
    );
  }

  const payload = await response.json().catch(() => null);
  const details = errorDetails(payload);

  if (!response.ok) {
    const retryable = response.status === 408 || response.status === 429 ||
      response.status >= 500 ||
      (response.status === 409 &&
        details.name === "concurrent_idempotent_requests");
    throw new DeliveryError(
      details.message ?? `Resend request failed with status ${response.status}`,
      retryable,
    );
  }

  const id = payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>).id
    : undefined;
  if (typeof id !== "string" || !id) {
    throw new DeliveryError("Resend returned no email ID", true);
  }

  return { id };
}

export async function runNotificationWorker(
  dependencies: NotificationWorkerDependencies,
): Promise<NotificationWorkerResult> {
  const deliveries = await dependencies.claimDeliveries();
  const result: NotificationWorkerResult = {
    claimed: deliveries.length,
    sent: 0,
    retrying: 0,
    failed: 0,
    errors: [],
  };

  for (const delivery of deliveries) {
    try {
      const sent = await dependencies.sendEmail(delivery);
      await dependencies.completeDelivery(delivery, sent.id);
      result.sent += 1;
    } catch (error) {
      const retryable = error instanceof DeliveryError
        ? error.retryable
        : true;
      const message = error instanceof Error ? error.message : "Unknown delivery error";

      try {
        const status = await dependencies.failDelivery(
          delivery,
          message,
          retryable,
        );
        if (status === "pending") result.retrying += 1;
        else if (status === "failed") result.failed += 1;
      } catch (recordingError) {
        result.errors.push(
          `${delivery.eventId}: ${message}; failure recording also failed: ${
            recordingError instanceof Error
              ? recordingError.message
              : "Unknown database error"
          }`,
        );
        continue;
      }

      result.errors.push(`${delivery.eventId}: ${message}`);
    }
  }

  return result;
}
