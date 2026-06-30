#!/usr/bin/env node
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigStore } from "./configStore.js";
import { ProcessManager } from "./processManager.js";
import { registerOperatorRoutes } from "./routes.js";

const rootDir = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const packageJson = JSON.parse(await readFile(resolve(rootDir, "operator/package.json"), "utf8")) as { version: string };

export async function buildOperatorServer() {
  const app = Fastify({ logger: true });
  await app.register(cors, {
    origin(origin, callback) {
      if (!origin || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("CORS is limited to localhost origins"), false);
    },
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
  });
  await registerOperatorRoutes(app, {
    configs: new ConfigStore(configPath()),
    processes: new ProcessManager(rootDir),
    version: packageJson.version,
  });
  const webDist = resolve(rootDir, "operator/web/dist");
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: "/",
      wildcard: false,
    });
    app.setNotFoundHandler(async (request, reply) => {
      if (request.raw.url?.startsWith("/api/")) {
        return reply.code(404).send({ error: "Unknown operator API route" });
      }
      return reply.sendFile("index.html");
    });
  } else {
    app.get("/", async () => ({
      error: "Operator web build is missing",
      fix: "Run npm run build --prefix operator",
    }));
  }
  return app;
}

function configPath(): string {
  const configured = process.env.OPERATOR_CONFIG_PATH;
  if (!configured) {
    return resolve(rootDir, "operator/.zeroarena/operator-config.json");
  }
  return resolve(rootDir, configured);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const requestedPort = Number(process.env.OPERATOR_PORT ?? process.env.PORT ?? 8788);
  const app = await buildOperatorServer();
  const address = await listenWithFallback(app, requestedPort);
  console.log(`ZeroArena Local Operator: ${address}`);
}

async function listenWithFallback(app: Awaited<ReturnType<typeof buildOperatorServer>>, port: number): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = port + attempt;
    try {
      await app.listen({ host: "127.0.0.1", port: candidate });
      return `http://127.0.0.1:${candidate}`;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") {
        throw error;
      }
    }
  }
  throw new Error(`No available local operator port found from ${port} to ${port + 9}`);
}
