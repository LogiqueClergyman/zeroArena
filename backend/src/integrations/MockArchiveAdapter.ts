import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TurnRecord } from "../core/types.js";
import {
  buildCanonicalArchivePayload,
  type ArchiveAdapter,
} from "./ArchiveAdapter.js";

export class MockArchiveAdapter implements ArchiveAdapter {
  readonly mode = "mock" as const;

  constructor(private readonly outputDir?: string) {}

  async archiveMatch(input: {
    matchId: string;
    gameId: string;
    rulesHash: string;
    rulesUrl: string;
    rulesVersion: string;
    history: TurnRecord[];
    finalState: unknown;
  }): Promise<{ archiveHash: string; url?: string }> {
    const payload = buildCanonicalArchivePayload(input);
    const hash = createHash("sha256").update(payload).digest("hex");
    if (this.outputDir) {
      await mkdir(this.outputDir, { recursive: true });
      await writeFile(join(this.outputDir, `${input.matchId}.json`), payload, "utf8");
    }
    return {
      archiveHash: `mock-0g-${hash}`,
      url: this.outputDir ? `file://${join(this.outputDir, `${input.matchId}.json`)}` : undefined,
    };
  }
}
