import type { LLMCompletionInput, LLMCompletionResult, LLMProvider } from "../types.js";
import { ZeroGWalletAuth } from "../wallet/ZeroGWalletAuth.js";

export interface ZeroGServingProviderConfig {
  rpcUrl: string;
  providerAddress?: string;
  model?: string;
  autoFundBufferMultiplier?: number;
  requestSpacingMs?: number;
  temperature?: number;
  topP?: number;
  privateKeysByRef: Record<string, string>;
}

export class ZeroGServingProvider implements LLMProvider {
  readonly mode = "0g-serving" as const;
  private readonly authByRef = new Map<string, ZeroGWalletAuth>();
  private throttleQueue: Promise<void> = Promise.resolve();
  private nextRequestAt = 0;

  constructor(private readonly config: ZeroGServingProviderConfig) {}

  async complete(input: LLMCompletionInput): Promise<LLMCompletionResult> {
    const started = Date.now();
    const auth = this.authFor(input.privateKeyRef);
    const service = await auth.selectService();
    const model = input.model ?? this.config.model ?? service.model;
    const body = {
      model,
      messages: [
        {
          role: "system",
          content: "Return one JSON object only. Do not wrap it in Markdown. It must match the supplied action schema.",
        },
        { role: "user", content: input.prompt },
      ],
      temperature: this.config.temperature ?? 0.35,
      top_p: this.config.topP ?? 0.9,
    };
    const content = JSON.stringify(body);
    const headers = await auth.signedHeaders(content);
    await this.waitForRateLimitSlot();
    const response = await fetch(this.chatCompletionsEndpoint(service.endpoint), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: content,
    });
    const data = (await response.json().catch(() => undefined)) as
      | { id?: string; choices?: Array<{ message?: { content?: string } }>; usage?: unknown }
      | undefined;
    if (!response.ok) {
      const retryAfter = response.headers.get("retry-after");
      throw new Error(`0G inference failed: HTTP ${response.status}${retryAfter ? ` retry-after=${retryAfter}` : ""} ${JSON.stringify(data)}`);
    }
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) {
      throw new Error("0G inference returned no chat completion content");
    }
    const chatId = response.headers.get("ZG-Res-Key") ?? data?.id;
    await auth.processResponse(chatId, JSON.stringify(data?.usage ?? {}));
    return {
      text,
      provider: service.providerAddress,
      model,
      latencyMs: Date.now() - started,
    };
  }

  private authFor(privateKeyRef: string): ZeroGWalletAuth {
    const existing = this.authByRef.get(privateKeyRef);
    if (existing) {
      return existing;
    }
    const privateKey = this.config.privateKeysByRef[privateKeyRef];
    if (!privateKey) {
      throw new Error(`Missing private key for ${privateKeyRef}`);
    }
    const auth = new ZeroGWalletAuth({
      rpcUrl: this.config.rpcUrl,
      providerAddress: this.config.providerAddress,
      privateKey,
      autoFundBufferMultiplier: this.config.autoFundBufferMultiplier,
    });
    this.authByRef.set(privateKeyRef, auth);
    return auth;
  }

  private chatCompletionsEndpoint(endpoint: string): string {
    const trimmed = endpoint.replace(/\/$/, "");
    return trimmed.endsWith("/chat/completions") ? trimmed : `${trimmed}/chat/completions`;
  }

  private async waitForRateLimitSlot(): Promise<void> {
    const spacingMs = this.config.requestSpacingMs ?? 7_000;
    if (spacingMs <= 0) {
      return;
    }
    const previous = this.throttleQueue;
    let release!: () => void;
    this.throttleQueue = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    const waitMs = Math.max(0, this.nextRequestAt - Date.now());
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    this.nextRequestAt = Date.now() + spacingMs;
    release();
  }
}
