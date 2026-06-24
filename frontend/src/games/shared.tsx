import type { ReactNode } from "react";
import type { AgentLog, FundingTxReceipt, MatchReceipt, MatchStatus, MatchSummary, Player, RoundSummary } from "../api";

export function cx(...values: Array<string | false | undefined | null>): string {
  return values.filter(Boolean).join(" ");
}

export function initials(name?: string): string {
  if (!name) {
    return "??";
  }
  const trimmed = name.trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

export function shortId(value: string): string {
  if (!value) {
    return "—";
  }
  return value.length <= 10 ? value : `#${value.slice(-6)}`;
}

export function playerName(players: Player[], playerId: string): string {
  return players.find((player) => player.id === playerId)?.name ?? playerId;
}

export function formatPlayerMap(values: Record<string, number>, players: Player[]): string {
  return Object.entries(values)
    .map(([id, value]) => `${playerName(players, id)} ${value}`)
    .join(" / ");
}

export function formatMaybe(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return "pending";
  }
  return String(value);
}

export function shortHash(value?: string): string {
  if (!value) {
    return "";
  }
  if (value.length <= 18) {
    return value;
  }
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export function formatTime(value?: string): string {
  if (!value) {
    return "pending";
  }
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) {
    return value;
  }
  return time.toLocaleTimeString();
}

export function latestLogByPlayer(logs: AgentLog[]): Map<string, AgentLog> {
  const latest = new Map<string, AgentLog>();
  for (const log of logs) {
    latest.set(log.playerId, log);
  }
  return latest;
}

export function roundResultLabel(round: RoundSummary | undefined, players: Player[]): string {
  if (!round) {
    return "Reveal pending";
  }
  if (!round.winner) {
    return `Round ${round.round}: treasury rolls over`;
  }
  return `Round ${round.round}: ${playerName(players, round.winner)} takes ${round.treasury}`;
}

export function toRoman(value: number): string {
  if (!value || value < 1) {
    return "I";
  }
  const table: Array<[number, string]> = [
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let remaining = value;
  let result = "";
  for (const [num, sym] of table) {
    while (remaining >= num) {
      result += sym;
      remaining -= num;
    }
  }
  return result;
}

/* ============================ Shared UI Components ============================ */

export function EmptyState({ text }: { text: string }) {
  return <div className="empty-state">{text}</div>;
}

export function StatusBanner({ label, value, tone }: { label: string; value: string; tone: "good" | "warn" | "bad" }) {
  return (
    <div className={cx("status-banner", tone)}>
      <strong>{label}</strong>
      <span>{value}</span>
    </div>
  );
}

export function EvidenceRow({
  label,
  value,
  mono,
  tone,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: "good" | "warn" | "bad";
}) {
  return (
    <div className={cx("evidence-row", tone)}>
      <span>{label}</span>
      <strong className={mono ? "mono" : undefined}>{value}</strong>
    </div>
  );
}

export function FundingRow({ tx }: { tx: FundingTxReceipt }) {
  return (
    <div className="funding-row">
      <strong>{tx.playerId}</strong>
      <code>{tx.txHash}</code>
      <span>{tx.amountWei} wei</span>
      <small>{tx.walletAddress}</small>
    </div>
  );
}

export function CompactAgentCard({ player, latestLog, winner }: { player: Player; latestLog?: AgentLog; winner: boolean }) {
  const mode = latestLog?.inferenceMode ?? player.inferenceMode ?? player.agentKind ?? "pending";
  return (
    <article className={cx("agent-card", winner && "winner")}>
      <div className="agent-top">
        <div>
          <h3>{player.name || player.id}</h3>
          <small>{player.id}</small>
        </div>
        <span className={cx("pill", mode === "0g-serving" ? "good" : "warn")}>{mode}</span>
      </div>
      <EvidenceRow label="Wallet" value={player.walletAddress || "pending"} mono />
      <EvidenceRow label="Provider" value={latestLog?.provider ?? "pending"} />
      <EvidenceRow label="Model" value={latestLog?.model ?? "pending"} />
      <EvidenceRow label="Last latency" value={latestLog ? `${latestLog.latencyMs} ms` : "pending"} />
      {latestLog?.fallbackReason ? <StatusBanner tone="warn" label="Fallback" value={latestLog.fallbackReason} /> : null}
    </article>
  );
}
