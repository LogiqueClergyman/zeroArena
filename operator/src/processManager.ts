import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import type { AgentConfig, AgentProcessSummary, AgentStatus } from "./schemas.js";
import { maskSecret } from "./schemas.js";

interface ManagedProcess {
  child?: ChildProcess;
  summary: AgentProcessSummary;
  logs: string[];
  redactor: (line: string) => string;
  subscribers: Set<(event: ProcessEvent) => void>;
}

export interface ProcessEvent {
  type: "status" | "log";
  agent: AgentProcessSummary;
  line?: string;
}

export class ProcessManager {
  private readonly processes = new Map<string, ManagedProcess>();

  constructor(private readonly rootDir = resolve(process.cwd())) {}

  async start(config: AgentConfig): Promise<AgentProcessSummary> {
    await this.ensureSdkBuild();
    const id = randomUUID();
    const runnerPath = await this.writeRunner(id);
    const env = this.envForConfig(config);
    const summary: AgentProcessSummary = {
      id,
      configId: config.id,
      label: config.label,
      gameId: config.gameId,
      strategy: config.strategy,
      walletAddress: config.walletAddress,
      backendUrl: config.zeroArenaApiUrl,
      status: "starting",
      startedAt: new Date().toISOString(),
    };
    const managed: ManagedProcess = {
      summary,
      logs: [],
      redactor: createRedactor(Object.values(env).filter((value): value is string => typeof value === "string")),
      subscribers: new Set(),
    };
    this.processes.set(id, managed);
    const child = spawn(process.execPath, [runnerPath], {
      cwd: this.rootDir,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    managed.child = child;
    this.setStatus(managed, "joining");
    child.stdout.on("data", (chunk) => this.ingest(managed, chunk));
    child.stderr.on("data", (chunk) => this.ingest(managed, chunk, "stderr"));
    child.on("error", (error) => {
      managed.summary.error = error.message;
      this.setStatus(managed, "error");
    });
    child.on("exit", (code) => {
      managed.summary.exitCode = code;
      managed.summary.stoppedAt = new Date().toISOString();
      if (managed.summary.status === "stopped" || code === 0) {
        this.setStatus(managed, managed.summary.status === "stopped" ? "stopped" : "finished");
      } else {
        managed.summary.error = `Agent process exited with code ${code}`;
        this.setStatus(managed, "error");
      }
    });
    return summary;
  }

  stop(id: string): boolean {
    const managed = this.processes.get(id);
    if (!managed) {
      return false;
    }
    this.setStatus(managed, "stopped");
    managed.child?.kill();
    return true;
  }

  list(): AgentProcessSummary[] {
    return [...this.processes.values()].map((item) => ({ ...item.summary }));
  }

  logs(id: string): string[] {
    return [...(this.processes.get(id)?.logs ?? [])];
  }

  subscribe(id: string, send: (event: ProcessEvent) => void): () => void {
    const managed = this.processes.get(id);
    if (!managed) {
      return () => undefined;
    }
    managed.subscribers.add(send);
    send({ type: "status", agent: { ...managed.summary } });
    for (const line of managed.logs.slice(-20)) {
      send({ type: "log", agent: { ...managed.summary }, line });
    }
    return () => managed.subscribers.delete(send);
  }

  commandPreview(config: AgentConfig): { command: string; env: Record<string, string> } {
    const env = this.envForConfig(config);
    const masked = Object.fromEntries(
      Object.entries(env).map(([key, value]) => [key, key.includes("PRIVATE_KEY") ? maskSecret(value) : value]),
    );
    return {
      command: "npm run dev --prefix operator",
      env: masked,
    };
  }

  private ingest(managed: ManagedProcess, chunk: Buffer, stream = "stdout"): void {
    for (const raw of chunk.toString("utf8").split(/\r?\n/)) {
      if (!raw.trim()) {
        continue;
      }
      const line = managed.redactor(raw.trim());
      managed.logs.push(`${new Date().toISOString()} ${stream} ${line}`);
      managed.logs = managed.logs.slice(-500);
      this.applyLogStatus(managed, line);
      this.emit(managed, { type: "log", agent: { ...managed.summary }, line: managed.logs.at(-1) });
    }
  }

  private applyLogStatus(managed: ManagedProcess, line: string): void {
    const parsed = parseJsonLine(line);
    if (!parsed) {
      return;
    }
    if (typeof parsed.matchId === "string") {
      managed.summary.matchId = parsed.matchId;
    }
    if (parsed.event === "agent_waiting_for_match") {
      this.setStatus(managed, "waiting");
    } else if (parsed.event === "agent_matched") {
      this.setStatus(managed, "matched");
    } else if (parsed.event === "agent_move_submitted" || parsed.event === "agent_fallback_move_submitted") {
      this.setStatus(managed, "playing");
    } else if (parsed.event === "agent_finished") {
      this.setStatus(managed, "finished");
    } else if (parsed.event === "agent_stopped") {
      this.setStatus(managed, "stopped");
    }
  }

  private setStatus(managed: ManagedProcess, status: AgentStatus): void {
    managed.summary.status = status;
    this.emit(managed, { type: "status", agent: { ...managed.summary } });
  }

  private emit(managed: ManagedProcess, event: ProcessEvent): void {
    for (const send of managed.subscribers) {
      send(event);
    }
  }

  private async ensureSdkBuild(): Promise<void> {
    await new Promise<void>((resolvePromise, reject) => {
      const npm = process.platform === "win32" ? "npm.cmd" : "npm";
      const child = spawn(npm, ["run", "build", "--prefix", "sdk/agent"], {
        cwd: this.rootDir,
        shell: process.platform === "win32",
        stdio: "ignore",
      });
      child.on("exit", (code) => code === 0 ? resolvePromise() : reject(new Error("Missing SDK build; run npm run build --prefix sdk/agent")));
      child.on("error", reject);
    });
  }

  private async writeRunner(id: string): Promise<string> {
    const dir = resolve(this.rootDir, "operator/.zeroarena/runners");
    await mkdir(dir, { recursive: true });
    const file = resolve(dir, `${id}.mjs`);
    await writeFile(file, runnerSource(pathToFileURL(resolve(this.rootDir, "sdk/agent/dist/index.js")).href), { mode: 0o700 });
    return file;
  }

  private envForConfig(config: AgentConfig): Record<string, string> {
    const agent = "OPERATOR";
    return {
      ZEROARENA_OPERATOR_STRATEGY: config.strategy,
      ZEROARENA_API_URL: config.zeroArenaApiUrl,
      ZEROARENA_GAME_ID: config.gameId,
      ZEROARENA_AGENT_LABEL: config.label,
      ZEROARENA_LOCAL_DEV_AUTH: String(config.allowLocalDevAuth),
      ZEROARENA_AGENT_PROMPT: config.prompt ?? "",
      ZERO_G_EVM_RPC_URL: config.zeroGRpcUrl ?? "",
      ZERO_G_PROVIDER_ADDRESS: config.zeroGProviderAddress ?? "",
      ZERO_G_SERVING_MODEL: config.zeroGModel ?? "",
      ZERO_G_INFERENCE_REQUEST_SPACING_MS: String(config.requestSpacingMs),
      ZERO_G_INFERENCE_TEMPERATURE: String(config.temperature ?? ""),
      ZERO_G_INFERENCE_TOP_P: String(config.topP ?? ""),
      [`AGENT_${agent}_WALLET_ADDRESS`]: config.walletAddress,
      [`AGENT_${agent}_PRIVATE_KEY`]: config.privateKey ?? "",
    };
  }
}

export function createRedactor(secrets: string[]): (line: string) => string {
  const needles = secrets.filter((value) => value && value.length >= 8);
  return (line: string) => {
    let next = line.replace(/0x[a-fA-F0-9]{64}/g, "[redacted-private-key]");
    for (const secret of needles) {
      next = next.split(secret).join("[redacted-secret]");
    }
    return next;
  };
}

function parseJsonLine(line: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(line);
    return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function runnerSource(sdkUrl: string): string {
  return `
import {
  AgentRunner,
  Connect4BasicStrategy,
  LlmJsonStrategy,
  SovereignBluffBasicStrategy,
  ZeroArenaClient,
  ZeroGServingProvider,
} from ${JSON.stringify(sdkUrl)};

const strategyId = process.env.ZEROARENA_OPERATOR_STRATEGY;
const walletAddress = must("AGENT_OPERATOR_WALLET_ADDRESS");
const privateKey = process.env.AGENT_OPERATOR_PRIVATE_KEY;
const privateKeyRef = "AGENT_OPERATOR_PRIVATE_KEY";
const gameId = process.env.ZEROARENA_GAME_ID ?? (strategyId?.startsWith("sovereign") ? "sovereign-bluff" : "connect4");

const client = new ZeroArenaClient({
  baseUrl: process.env.ZEROARENA_API_URL ?? "http://127.0.0.1:3001",
  walletAddress,
  privateKey,
  allowLocalDevAuth: process.env.ZEROARENA_LOCAL_DEV_AUTH === "true",
});

const strategy = buildStrategy();
const runner = new AgentRunner(client, strategy, {
  gameId,
  walletAddress,
  name: process.env.ZEROARENA_AGENT_LABEL ?? "Local Operator Agent",
  nearTimeoutMs: strategyId?.includes("sovereign") ? 5000 : undefined,
});

await runner.run();

function buildStrategy() {
  if (strategyId === "connect4-basic") return new Connect4BasicStrategy();
  if (strategyId === "sovereign-bluff-basic") return new SovereignBluffBasicStrategy("measured");
  const provider = new ZeroGServingProvider({
    rpcUrl: process.env.ZERO_G_EVM_RPC_URL || process.env.EVM_RPC_URL || "https://evmrpc-testnet.0g.ai",
    providerAddress: process.env.ZERO_G_PROVIDER_ADDRESS,
    model: process.env.ZERO_G_SERVING_MODEL,
    requestSpacingMs: Number(process.env.ZERO_G_INFERENCE_REQUEST_SPACING_MS ?? 7000),
    temperature: numberOrUndefined(process.env.ZERO_G_INFERENCE_TEMPERATURE),
    topP: numberOrUndefined(process.env.ZERO_G_INFERENCE_TOP_P),
    privateKeysByRef: { [privateKeyRef]: must("AGENT_OPERATOR_PRIVATE_KEY") },
  });
  if (strategyId === "connect4-0g") {
    return new LlmJsonStrategy({
      provider,
      walletAddress,
      privateKeyRef,
      userPrompt: process.env.ZEROARENA_AGENT_PROMPT || defaultConnect4Prompt(),
      extraContext: ({ publicState, playerId }) => connect4Context(publicState, playerId),
      fallback: new Connect4BasicStrategy(),
    });
  }
  if (strategyId === "sovereign-bluff-0g") {
    return new LlmJsonStrategy({
      provider,
      walletAddress,
      privateKeyRef,
      userPrompt: process.env.ZEROARENA_AGENT_PROMPT || "Sovereign Bluff agent. Preserve balance, exploit weak bids, and return legal JSON only.",
      fallback: new SovereignBluffBasicStrategy("measured"),
    });
  }
  throw new Error("Unsupported strategy: " + strategyId);
}

function defaultConnect4Prompt() {
  return [
    "Play Connect4 to win.",
    "Return exactly one JSON object: {\\\"column\\\": number}.",
    "Choose only from publicState.validColumns.",
    "Look for immediate wins, then blocks, then position.",
  ].join("\\n");
}

function connect4Context(publicState, playerId) {
  const state = typeof publicState === "object" && publicState !== null ? publicState : {};
  const board = Array.isArray(state.board) ? state.board : [];
  const validColumns = Array.isArray(state.validColumns) ? state.validColumns : [];
  const players = Array.isArray(state.players) ? state.players : [];
  return { myPlayerId: playerId, opponentPlayerId: players.find((p) => p !== playerId), validColumns, board };
}

function must(name) {
  const value = process.env[name];
  if (!value) throw new Error("Missing " + name);
  return value;
}

function numberOrUndefined(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}
`;
}
