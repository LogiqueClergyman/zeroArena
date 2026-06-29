import type { LLMCompletionInput, LLMCompletionResult, LLMProvider } from "../types.js";

export class MockProvider implements LLMProvider {
  readonly mode = "mock" as const;

  async complete(input: LLMCompletionInput): Promise<LLMCompletionResult> {
    return {
      text: JSON.stringify({ column: /VALID_COLUMNS:\[([0-9,]+)\]/.exec(input.prompt)?.[1]?.split(",").map(Number)[0] ?? 3 }),
      provider: "local-mock-provider",
      model: "mock-json",
      latencyMs: 0,
    };
  }
}
