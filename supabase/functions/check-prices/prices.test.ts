import {
  assert,
  assertEquals,
  assertRejects,
} from "@std/assert";
import {
  isAuthorizedRequest,
  normalizeCoinIds,
  parseCoinGeckoPrices,
  runPriceCheck,
  splitIntoPriceBatches,
} from "./prices.ts";

Deno.test("authorization requires the exact configured worker secret", () => {
  assert(!isAuthorizedRequest(new Request("http://localhost"), "secret"));
  assert(!isAuthorizedRequest(
    new Request("http://localhost", {
      headers: { "x-worker-secret": "wrong" },
    }),
    "secret",
  ));
  assert(isAuthorizedRequest(
    new Request("http://localhost", {
      headers: { "x-worker-secret": "secret" },
    }),
    "secret",
  ));
});

Deno.test("watched IDs are trimmed, deduplicated, sorted, and batched by 250", () => {
  const ids = normalizeCoinIds([
    ...Array.from({ length: 501 }, (_, index) => `coin-${index}`),
    " coin-0 ",
    "",
    null,
  ]);
  const batches = splitIntoPriceBatches(ids);

  assertEquals(ids.length, 501);
  assertEquals(batches.map((batch) => batch.length), [250, 250, 1]);
});

Deno.test("CoinGecko parser keeps only positive prices with provider timestamps", () => {
  const rows = parseCoinGeckoPrices(
    ["bitcoin", "missing", "zero", "no-time"],
    {
      bitcoin: { usd: 101_250.5, last_updated_at: 1_700_000_000 },
      zero: { usd: 0, last_updated_at: 1_700_000_000 },
      "no-time": { usd: 2 },
    },
  );

  assertEquals(rows, [{
    coin_id: "bitcoin",
    price_usd: 101_250.5,
    provider_updated_at: "2023-11-14T22:13:20.000Z",
  }]);
});

Deno.test("an empty watchlist skips the price API", async () => {
  let fetchCalls = 0;
  const result = await runPriceCheck({
    listWatchedCoinIds: () => Promise.resolve([]),
    fetchPricePayload: () => {
      fetchCalls += 1;
      return Promise.resolve({});
    },
    processPriceRows: () => Promise.resolve({ pricesUpdated: 0, eventsCreated: 0 }),
  });

  assertEquals(fetchCalls, 0);
  assert(result.skipped);
  assertEquals(result.batches, 0);
});

Deno.test("a failed price batch does not block later batches", async () => {
  const watched = Array.from({ length: 251 }, (_, index) => `coin-${index}`);
  const processed: string[][] = [];
  let fetchCalls = 0;

  const result = await runPriceCheck({
    listWatchedCoinIds: () => Promise.resolve(watched),
    fetchPricePayload: (batch) => {
      fetchCalls += 1;
      if (fetchCalls === 1) return Promise.reject(new Error("rate limited"));
      return Promise.resolve({
        [batch[0]]: { usd: 1.5, last_updated_at: 1_700_000_000 },
      });
    },
    processPriceRows: (rows) => {
      processed.push(rows.map((row) => row.coin_id));
      return Promise.resolve({ pricesUpdated: rows.length, eventsCreated: 1 });
    },
    now: () => new Date("2023-11-14T22:14:00.000Z"),
  });

  assertEquals(result.failedBatches, 1);
  assertEquals(result.successfulBatches, 1);
  assertEquals(result.pricesUpdated, 1);
  assertEquals(result.eventsCreated, 1);
  assertEquals(processed.length, 1);
});

Deno.test("invalid watched ID response fails before calling providers", async () => {
  await assertRejects(
    () => runPriceCheck({
      listWatchedCoinIds: () => Promise.resolve(null as unknown as string[]),
      fetchPricePayload: () => Promise.resolve({}),
      processPriceRows: () => Promise.resolve({ pricesUpdated: 0, eventsCreated: 0 }),
    }),
    Error,
    "did not return an array",
  );
});
