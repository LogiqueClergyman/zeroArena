import { existsSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { ethers } from "ethers";
import { Indexer, ZgFile } from "@0gfoundation/0g-storage-ts-sdk";

loadEnv({ path: resolve(process.cwd(), ".env") });

const required = [
  "ZERO_G_STORAGE_RPC",
  "ZERO_G_STORAGE_INDEXER_RPC",
  "ZERO_G_STORAGE_PRIVATE_KEY",
].filter((key) => !process.env[key]);

if (required.length) {
  throw new Error(`Missing required env for rulebook upload: ${required.join(", ")}`);
}

const rulebookPath = resolve(process.cwd(), "rulebooks", "sovereign-bluff.v1.json");
if (!existsSync(rulebookPath)) {
  throw new Error(`Rulebook file not found: ${rulebookPath}`);
}

const rpcUrl = process.env.ZERO_G_STORAGE_RPC!;
const indexerRpc = process.env.ZERO_G_STORAGE_INDEXER_RPC!;
const signer = new ethers.Wallet(
  process.env.ZERO_G_STORAGE_PRIVATE_KEY!,
  new ethers.JsonRpcProvider(rpcUrl),
);
const indexer = new Indexer(indexerRpc);
const file = await ZgFile.fromFilePath(rulebookPath);

try {
  const [tree, treeErr] = await file.merkleTree();
  if (treeErr !== null) {
    throw new Error(`0G Storage merkle tree failed: ${treeErr.message}`);
  }

  const [tx, uploadErr] = await indexer.upload(file, rpcUrl, signer as never);
  if (uploadErr !== null) {
    throw new Error(`0G Storage upload failed: ${uploadErr.message}`);
  }

  const rootHash = "rootHash" in tx ? tx.rootHash : tx.rootHashes[0];
  if (!rootHash) {
    throw new Error(`0G Storage upload did not return a root hash; local root was ${tree?.rootHash()}`);
  }

  console.log(`SOVEREIGN_BLUFF_RULEBOOK_HASH=${rootHash}`);
  console.log(
    `SOVEREIGN_BLUFF_RULEBOOK_URL=Download with 0G Storage SDK Indexer.download(${rootHash}, outputPath, true) via ${indexerRpc}`,
  );
} finally {
  await file.close();
}
