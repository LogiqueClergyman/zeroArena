import test from "node:test";
import assert from "node:assert/strict";
import { buildOperatorServer } from "./server.js";

test("local API health route returns operator metadata", async () => {
  const app = await buildOperatorServer();
  const response = await app.inject({ method: "GET", url: "/api/health" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, true);
  await app.close();
});
