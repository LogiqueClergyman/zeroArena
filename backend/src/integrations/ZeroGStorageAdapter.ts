import { ethers } from "ethers";
import { Indexer, MemData } from "@0gfoundation/0g-storage-ts-sdk";
import type { TurnRecord } from "../core/types.js";
import {
  buildCanonicalArchivePayload,
  type ArchiveAdapter,
} from "./ArchiveAdapter.js";

export interface ZeroGStorageAdapterOptions {
  evmRpcUrl: string;
  privateKey: string;
  indexerRpc: string;
}

export class ZeroGStorageAdapter implements ArchiveAdapter {
  readonly mode = "0g" as const;

  private readonly provider: ethers.JsonRpcProvider;
  private readonly signer: ethers.Wallet;
  private readonly indexer: Indexer;

  constructor(private readonly options: ZeroGStorageAdapterOptions) {
    if (!options.evmRpcUrl) {
      throw new Error("ZERO_G_STORAGE_RPC or EVM_RPC_URL is required for ARCHIVE_MODE=0g");
    }
    if (!options.privateKey) {
      throw new Error("ZERO_G_STORAGE_PRIVATE_KEY is required for ARCHIVE_MODE=0g");
    }
    if (!options.indexerRpc) {
      throw new Error("ZERO_G_STORAGE_INDEXER_RPC is required for ARCHIVE_MODE=0g");
    }
    this.provider = new ethers.JsonRpcProvider(options.evmRpcUrl);
    this.signer = new ethers.Wallet(options.privateKey, this.provider);
    this.indexer = new Indexer(options.indexerRpc);
  }

  async archiveMatch(input: {
    matchId: string;
    gameId: string;
    rulesHash: string;
    rulesUrl: string;
    rulesVersion: string;
    history: TurnRecord[];
    finalState: unknown;
  }): Promise<{ archiveHash: string; url?: string; txHash?: string }> {
    const payload = buildCanonicalArchivePayload(input);
    const data = new TextEncoder().encode(payload);
    const memData = new MemData(data);
    const [tree, treeErr] = await memData.merkleTree();
    if (treeErr !== null) {
      throw new Error(`0G Storage merkle tree failed: ${treeErr.message}`);
    }

    const [tx, uploadErr] = await this.indexer.upload(
      memData,
      this.options.evmRpcUrl,
      this.signer as never,
    );
    if (uploadErr !== null) {
      throw new Error(`0G Storage upload failed: ${uploadErr.message}`);
    }

    if ("rootHash" in tx) {
      return {
        archiveHash: tx.rootHash || tree?.rootHash() || "",
        txHash: tx.txHash,
        url: `Download with 0G Storage SDK Indexer.download(${tx.rootHash}, outputPath, true) via ${this.options.indexerRpc}`,
      };
    }

    const archiveHash = tx.rootHashes[0] ?? tree?.rootHash() ?? "";
    return {
      archiveHash,
      txHash: tx.txHashes[0],
      url: `Download with 0G Storage SDK Indexer.download(${archiveHash}, outputPath, true) via ${this.options.indexerRpc}`,
    };
  }
}
