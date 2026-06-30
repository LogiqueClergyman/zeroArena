import { Connect4 } from "@zeroarena/game-connect4";
import { SignalDuel } from "@zeroarena/game-signal-duel";
import { SovereignBluff } from "@zeroarena/game-sovereign-bluff";
import type { IGameEngine } from "@zeroarena/game-sdk";
import { localDevRulesHash } from "../integrations/LocalDevPrizePoolAdapter.js";
import type { RulebookCommitment } from "../core/MatchCoordinator.js";

export interface RegisteredGame {
  engine: IGameEngine;
  rulebook: RulebookCommitment;
}

export function loadBuiltInGames(env: NodeJS.ProcessEnv): RegisteredGame[] {
  return [
    {
      engine: new SovereignBluff(),
      rulebook: rulebookFromEnv(env, {
        gameId: "sovereign-bluff",
        envPrefix: "SOVEREIGN_BLUFF",
      }),
    },
    {
      engine: new Connect4(),
      rulebook: rulebookFromEnv(env, {
        gameId: "connect4",
        envPrefix: "CONNECT4",
      }),
    },
    {
      engine: new SignalDuel(),
      rulebook: rulebookFromEnv(env, {
        gameId: "signal-duel",
        envPrefix: "SIGNAL_DUEL",
      }),
    },
  ];
}

function rulebookFromEnv(
  env: NodeJS.ProcessEnv,
  input: { gameId: string; envPrefix: string },
): RulebookCommitment {
  const localDevAllowMocks = env.LOCAL_DEV_ALLOW_MOCKS === "true";
  const rulesHash = env[`${input.envPrefix}_RULEBOOK_HASH`] ?? (localDevAllowMocks ? localDevRulesHash() : "");
  const rulesUrl =
    env[`${input.envPrefix}_RULEBOOK_URL`] ?? (localDevAllowMocks ? "local-dev-rulebook-not-0g" : "");
  const rulesVersion =
    env[`${input.envPrefix}_RULEBOOK_VERSION`] ?? (localDevAllowMocks ? "local-dev" : "");

  if (!localDevAllowMocks && (!rulesHash || !rulesUrl || !rulesVersion)) {
    throw new Error(
      `${input.gameId} rulebook env is incomplete; set ${input.envPrefix}_RULEBOOK_HASH, ${input.envPrefix}_RULEBOOK_URL, and ${input.envPrefix}_RULEBOOK_VERSION`,
    );
  }

  return { rulesHash, rulesUrl, rulesVersion };
}
