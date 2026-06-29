export interface LLMCompletionInput {
  prompt: string;
  walletAddress: string;
  privateKeyRef: string;
  model?: string;
}

export interface LLMCompletionResult {
  text: string;
  provider: string;
  model: string;
  latencyMs: number;
}

export interface LLMProvider {
  readonly mode: "0g-serving" | "mock";
  complete(input: LLMCompletionInput): Promise<LLMCompletionResult>;
}
