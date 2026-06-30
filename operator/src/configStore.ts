import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentConfig, MaskedAgentConfig } from "./schemas.js";
import { maskConfig, validateConfig } from "./schemas.js";

export class ConfigStore {
  constructor(private readonly filePath = resolve(process.cwd(), "operator/.zeroarena/operator-config.json")) {}

  async listMasked(): Promise<MaskedAgentConfig[]> {
    return (await this.read()).map(maskConfig);
  }

  async get(id: string): Promise<AgentConfig | undefined> {
    return (await this.read()).find((config) => config.id === id);
  }

  async upsert(input: Partial<AgentConfig>): Promise<MaskedAgentConfig> {
    const existing = input.id ? await this.get(input.id) : undefined;
    const now = new Date().toISOString();
    const next: AgentConfig = {
      id: input.id ?? randomUUID(),
      label: input.label ?? existing?.label ?? "",
      gameId: input.gameId ?? existing?.gameId ?? "connect4",
      strategy: input.strategy ?? existing?.strategy ?? "connect4-basic",
      walletAddress: input.walletAddress ?? existing?.walletAddress ?? "",
      privateKey: input.privateKey && !input.privateKey.includes("*") ? input.privateKey : existing?.privateKey,
      zeroArenaApiUrl: input.zeroArenaApiUrl ?? existing?.zeroArenaApiUrl ?? "http://127.0.0.1:3001",
      zeroGRpcUrl: input.zeroGRpcUrl ?? existing?.zeroGRpcUrl ?? "https://evmrpc-testnet.0g.ai",
      zeroGProviderAddress: input.zeroGProviderAddress ?? existing?.zeroGProviderAddress,
      zeroGModel: input.zeroGModel ?? existing?.zeroGModel,
      requestSpacingMs: Number(input.requestSpacingMs ?? existing?.requestSpacingMs ?? 7000),
      temperature: optionalNumber(input.temperature ?? existing?.temperature),
      topP: optionalNumber(input.topP ?? existing?.topP),
      prompt: input.prompt ?? existing?.prompt,
      allowLocalDevAuth: Boolean(input.allowLocalDevAuth ?? existing?.allowLocalDevAuth ?? false),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    const issues = validateConfig(next);
    if (issues.length) {
      throw new ConfigValidationError(issues);
    }
    const configs = (await this.read()).filter((config) => config.id !== next.id);
    configs.push(next);
    await this.write(configs);
    return maskConfig(next);
  }

  async delete(id: string): Promise<boolean> {
    const configs = await this.read();
    const next = configs.filter((config) => config.id !== id);
    if (next.length === configs.length) {
      return false;
    }
    await this.write(next);
    return true;
  }

  private async read(): Promise<AgentConfig[]> {
    try {
      return JSON.parse(await readFile(this.filePath, "utf8")) as AgentConfig[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  private async write(configs: AgentConfig[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(configs, null, 2)}\n`, { mode: 0o600 });
    await rename(tmp, this.filePath);
  }
}

export class ConfigValidationError extends Error {
  constructor(readonly issues: Array<{ field: string; message: string }>) {
    super("Invalid agent config");
  }
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}
