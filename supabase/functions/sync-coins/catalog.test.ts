import {
  assertEquals,
  assertThrows,
} from "jsr:@std/assert@1";
import { parseCoinCatalog, splitIntoBatches } from "./catalog.ts";

Deno.test("parseCoinCatalog keeps valid CoinGecko ids and duplicate symbols", () => {
  const result = parseCoinCatalog([
    { id: "cardano", name: "Cardano", symbol: "ada" },
    { id: "another-ada", name: "Ada Token", symbol: "ada" },
    { id: "cardano", name: "Cardano updated", symbol: "ada" },
    { id: "", name: "Invalid", symbol: "bad" },
  ]);

  assertEquals(result, [
    { id: "cardano", name: "Cardano updated", symbol: "ada" },
    { id: "another-ada", name: "Ada Token", symbol: "ada" },
  ]);
});

Deno.test("parseCoinCatalog rejects an invalid or empty response", () => {
  assertThrows(() => parseCoinCatalog({}), Error);
  assertThrows(() => parseCoinCatalog([]), Error);
});

Deno.test("splitIntoBatches preserves every catalog row", () => {
  assertEquals(splitIntoBatches([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assertThrows(() => splitIntoBatches([1], 0), Error);
});

