import type { LLMCompletionInput, LLMCompletionResult, LLMProvider } from "./LLMProvider.js";
import { ZeroGWalletAuth } from "./ZeroGWalletAuth.js";

export interface ZeroGServingProviderConfig {
  rpcUrl: string;
  providerAddress?: string;
  model?: string;
  privateKeysByRef: Record<string, string>;
}

export class ZeroGServingProvider implements LLMProvider {
  readonly mode = "0g-serving" as const;
  private readonly authByRef = new Map<string, ZeroGWalletAuth>();

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
          content:
            "Return one JSON object only. Do not wrap it in Markdown. It must match the supplied action schema.",
        },
        { role: "user", content: input.prompt },
      ],
      temperature: 0.2,
    };
    const content = JSON.stringify(body);
    const headers = await auth.signedHeaders(content);
    const endpoint = this.chatCompletionsEndpoint(service.endpoint);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: content,
    });
    const data = (await response.json().catch(() => undefined)) as
      | { id?: string; choices?: Array<{ message?: { content?: string } }>; usage?: unknown }
      | undefined;
    if (!response.ok) {
      throw new Error(`0G inference failed: HTTP ${response.status} ${JSON.stringify(data)}`);
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
    });
    this.authByRef.set(privateKeyRef, auth);
    return auth;
  }

  private chatCompletionsEndpoint(endpoint: string): string {
    const trimmed = endpoint.replace(/\/$/, "");
    if (trimmed.endsWith("/chat/completions")) {
      return trimmed;
    }
    return `${trimmed}/chat/completions`;
  }
}
