import type { FastifyInstance } from "fastify";
import { ConfigStore, ConfigValidationError } from "./configStore.js";
import { checkBackendHealth, fetchBackendGames } from "./backendClient.js";
import { ProcessManager } from "./processManager.js";

export interface OperatorRoutesOptions {
  configs: ConfigStore;
  processes: ProcessManager;
  version: string;
}

export async function registerOperatorRoutes(app: FastifyInstance, options: OperatorRoutesOptions): Promise<void> {
  const { configs, processes, version } = options;

  app.get("/api/health", async () => ({
    ok: true,
    version,
    localOnly: true,
    message: "ZeroArena Local Operator is running on this machine.",
  }));

  app.get<{ Querystring: { baseUrl?: string } }>("/api/backend/health", async (request) =>
    checkBackendHealth(request.query.baseUrl ?? "http://127.0.0.1:3001"),
  );

  app.get<{ Querystring: { baseUrl?: string } }>("/api/backend/games", async (request, reply) => {
    try {
      return await fetchBackendGames(request.query.baseUrl ?? "http://127.0.0.1:3001");
    } catch (error) {
      return reply.code(502).send({ error: errorMessage(error), games: [] });
    }
  });

  app.get("/api/configs", async () => configs.listMasked());

  app.post<{ Body: Record<string, unknown> }>("/api/configs", async (request, reply) => {
    try {
      return await configs.upsert(request.body);
    } catch (error) {
      if (error instanceof ConfigValidationError) {
        return reply.code(400).send({ error: error.message, issues: error.issues });
      }
      return reply.code(500).send({ error: errorMessage(error) });
    }
  });

  app.delete<{ Params: { id: string } }>("/api/configs/:id", async (request, reply) => {
    const deleted = await configs.delete(request.params.id);
    return deleted ? { ok: true } : reply.code(404).send({ error: "Unknown config" });
  });

  app.post<{ Body: { configId?: string } }>("/api/agents/start", async (request, reply) => {
    if (!request.body?.configId) {
      return reply.code(400).send({ error: "configId is required" });
    }
    const config = await configs.get(request.body.configId);
    if (!config) {
      return reply.code(404).send({ error: "Unknown config" });
    }
    try {
      const agent = await processes.start(config);
      return { localAgentId: agent.id, agent };
    } catch (error) {
      return reply.code(500).send({ error: errorMessage(error) });
    }
  });

  app.post<{ Params: { id: string } }>("/api/agents/:id/stop", async (request, reply) => {
    return processes.stop(request.params.id)
      ? { ok: true }
      : reply.code(404).send({ error: "Unknown local agent" });
  });

  app.get("/api/agents", async () => processes.list());

  app.get<{ Params: { id: string } }>("/api/agents/:id/logs", async (request, reply) => {
    const logs = processes.logs(request.params.id);
    if (!processes.list().some((agent) => agent.id === request.params.id)) {
      return reply.code(404).send({ error: "Unknown local agent" });
    }
    return { logs };
  });

  app.get<{ Params: { id: string } }>("/api/agents/:id/events", async (request, reply) => {
    if (!processes.list().some((agent) => agent.id === request.params.id)) {
      return reply.code(404).send({ error: "Unknown local agent" });
    }
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const unsubscribe = processes.subscribe(request.params.id, (event) => {
      reply.raw.write(`event: ${event.type}\n`);
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    });
    request.raw.on("close", unsubscribe);
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
