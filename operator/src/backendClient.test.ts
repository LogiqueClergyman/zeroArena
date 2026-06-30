import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { fetchBackendGames } from "./backendClient.js";

test("fetches and normalizes backend games", async () => {
  const server = await testServer(JSON.stringify([
    { id: "connect4", name: "Connect Four", minPlayers: 2, maxPlayers: 2, rulesHash: "0xabc" },
  ]));
  try {
    const result = await fetchBackendGames(server.url);
    assert.equal(result.games[0].id, "connect4");
    assert.equal(result.games[0].rulesHash, "0xabc");
  } finally {
    await server.close();
  }
});

async function testServer(body: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("server did not bind");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
