import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "@std/assert";
import {
  createEmailPayload,
  DeliveryError,
  type NotificationDelivery,
  notificationIdempotencyKey,
  runNotificationWorker,
  sendWithResend,
} from "./notifications.ts";

const delivery: NotificationDelivery = {
  messageId: 42,
  eventId: "a5000000-0000-4000-8000-000000000001",
  recipientEmail: "owner@example.test",
  coinName: "Unsafe <Coin>",
  coinSymbol: "u&c",
  direction: "above",
  thresholdUsd: "100",
  triggerPriceUsd: "101.5",
  deliveryAttempt: 1,
};

Deno.test("email payload is deterministic and escapes user-visible catalog data", () => {
  const payload = createEmailPayload(delivery, "CryptoWatch <alerts@example.com>");

  assertEquals(
    notificationIdempotencyKey(delivery.eventId),
    `cryptowatch/notification/${delivery.eventId}`,
  );
  assertStringIncludes(payload.subject, "U&C");
  assertStringIncludes(payload.text, "Unsafe <Coin>");
  assertStringIncludes(payload.html, "Unsafe &lt;Coin&gt;");
  assertStringIncludes(payload.html, "U&amp;C");
});

Deno.test("Resend request includes a stable idempotency key", async () => {
  let capturedInit: RequestInit | undefined;
  const fetcher = ((_input: string | URL | Request, init?: RequestInit) => {
    capturedInit = init;
    return Promise.resolve(Response.json({ id: "email-123" }));
  }) as typeof fetch;

  const result = await sendWithResend(
    delivery,
    "re_test",
    "CryptoWatch <alerts@example.com>",
    fetcher,
  );

  assertEquals(result.id, "email-123");
  const headers = new Headers(capturedInit?.headers);
  assertEquals(
    headers.get("idempotency-key"),
    notificationIdempotencyKey(delivery.eventId),
  );
});

Deno.test("Resend transient and permanent errors are classified for retries", async () => {
  const responseFor = (status: number, name: string) =>
    ((_input: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(Response.json({ name, message: name }, { status }))) as typeof fetch;

  for (const [status, name, retryable] of [
    [429, "rate_limit_exceeded", true],
    [500, "internal_server_error", true],
    [409, "concurrent_idempotent_requests", true],
    [400, "validation_error", false],
    [409, "invalid_idempotent_request", false],
  ] as const) {
    try {
      await sendWithResend(
        delivery,
        "re_test",
        "CryptoWatch <alerts@example.com>",
        responseFor(status, name),
      );
      throw new Error("Expected sendWithResend to fail");
    } catch (error) {
      assert(error instanceof DeliveryError);
      assertEquals(error.retryable, retryable);
    }
  }
});

Deno.test("a crash after provider acceptance retries with the same key without a duplicate", async () => {
  const accepted = new Map<string, string>();
  let completeCalls = 0;
  let failureCalls = 0;

  const dependencies = {
    claimDeliveries: () => Promise.resolve([delivery]),
    sendEmail: (item: NotificationDelivery) => {
      const key = notificationIdempotencyKey(item.eventId);
      if (!accepted.has(key)) accepted.set(key, "email-accepted-once");
      return Promise.resolve({ id: accepted.get(key)! });
    },
    completeDelivery: () => {
      completeCalls += 1;
      if (completeCalls === 1) {
        return Promise.reject(new Error("database unavailable after send"));
      }
      return Promise.resolve();
    },
    failDelivery: () => {
      failureCalls += 1;
      return Promise.resolve("pending" as const);
    },
  };

  const first = await runNotificationWorker(dependencies);
  const second = await runNotificationWorker(dependencies);

  assertEquals(first.retrying, 1);
  assertEquals(second.sent, 1);
  assertEquals(failureCalls, 1);
  assertEquals(accepted.size, 1);
});

Deno.test("one failed email does not block the rest of a claimed batch", async () => {
  const second = { ...delivery, messageId: 43, eventId: crypto.randomUUID() };
  const failures: Array<{ retryable: boolean }> = [];
  const completed: string[] = [];

  const result = await runNotificationWorker({
    claimDeliveries: () => Promise.resolve([delivery, second]),
    sendEmail: (item) =>
      item.messageId === delivery.messageId
        ? Promise.reject(new DeliveryError("invalid sender", false))
        : Promise.resolve({ id: "email-second" }),
    completeDelivery: (item) => {
      completed.push(item.eventId);
      return Promise.resolve();
    },
    failDelivery: (_item, _message, retryable) => {
      failures.push({ retryable });
      return Promise.resolve("failed");
    },
  });

  assertEquals(result.claimed, 2);
  assertEquals(result.sent, 1);
  assertEquals(result.failed, 1);
  assertEquals(failures, [{ retryable: false }]);
  assertEquals(completed, [second.eventId]);
});

Deno.test("branded email links to the app in HTML and text, and keeps its payload across retries", () => {
  const first = createEmailPayload(delivery, "CryptoWatch <alerts@example.com>");
  const retry = createEmailPayload({ ...delivery, deliveryAttempt: 2 }, "CryptoWatch <alerts@example.com>");
  assertEquals(retry, first);
  assertStringIncludes(first.html, 'href="https://cryptowatch-demo.netlify.app/"');
  assertStringIncludes(first.text, "https://cryptowatch-demo.netlify.app/");
  assertStringIncludes(first.html, "Otevřít moje sledování");
  assertStringIncludes(first.html, 'lang="cs"');
  assert(!first.html.includes("Unsafe <Coin>"));
});
