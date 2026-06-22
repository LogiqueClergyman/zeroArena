import "@nomicfoundation/hardhat-toolbox";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import type { HardhatUserConfig } from "hardhat/config";

loadEnv({ path: resolve(process.cwd(), "..", "backend", ".env") });

const accounts = process.env.EVM_PRIVATE_KEY ? [process.env.EVM_PRIVATE_KEY] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    ogGalileo: {
      url: process.env.EVM_RPC_URL ?? "https://evmrpc-testnet.0g.ai",
      chainId: Number(process.env.EVM_CHAIN_ID ?? 16602),
      accounts,
    },
  },
};

export default config;
