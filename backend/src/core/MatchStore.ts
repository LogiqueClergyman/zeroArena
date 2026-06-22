import type { Match, MatchReceipt, TurnRecord } from "./types.js";

export class MatchStore {
  private readonly matches = new Map<string, Match>();
  private readonly histories = new Map<string, TurnRecord[]>();
  private readonly receipts = new Map<string, MatchReceipt>();

  create(match: Match): Match {
    if (this.matches.has(match.id)) {
      throw new Error(`Match already exists: ${match.id}`);
    }
    this.matches.set(match.id, match);
    this.histories.set(match.id, []);
    return match;
  }

  get(matchId: string): Match | undefined {
    return this.matches.get(matchId);
  }

  update(match: Match): Match {
    if (!this.matches.has(match.id)) {
      throw new Error(`Unknown match: ${match.id}`);
    }
    match.updatedAt = new Date().toISOString();
    this.matches.set(match.id, match);
    return match;
  }

  appendTurn(matchId: string, turn: TurnRecord): void {
    const history = this.histories.get(matchId);
    if (!history) {
      throw new Error(`Unknown match: ${matchId}`);
    }
    history.push(turn);
  }

  getHistory(matchId: string): TurnRecord[] {
    return [...(this.histories.get(matchId) ?? [])];
  }

  storeReceipt(matchId: string, receipt: MatchReceipt): void {
    const match = this.matches.get(matchId);
    if (!match) {
      throw new Error(`Unknown match: ${matchId}`);
    }
    this.receipts.set(matchId, receipt);
    match.receipt = receipt;
    this.update(match);
  }

  getReceipt(matchId: string): MatchReceipt | undefined {
    return this.receipts.get(matchId);
  }

  list(): Match[] {
    return [...this.matches.values()];
  }
}
