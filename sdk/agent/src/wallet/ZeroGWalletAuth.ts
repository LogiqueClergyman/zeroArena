import { ethers } from "ethers";
import { createZGComputeNetworkBroker } from "@0gfoundation/0g-compute-ts-sdk";

export interface ZeroGWalletAuthConfig {
  rpcUrl: string;
  providerAddress?: string;
  privateKey: string;
  autoFundBufferMultiplier?: number;
}

export interface ZeroGServiceSelection {
  broker: Awaited<ReturnType<typeof createZGComputeNetworkBroker>>;
  providerAddress: string;
  endpoint: string;
  model: string;
}

export class ZeroGWalletAuth {
  private selection?: ZeroGServiceSelection;

  constructor(private readonly config: ZeroGWalletAuthConfig) {}

  async selectService(): Promise<ZeroGServiceSelection> {
    if (this.selection) {
      return this.selection;
    }
    const provider = new ethers.JsonRpcProvider(this.config.rpcUrl);
    const wallet = new ethers.Wallet(this.config.privateKey, provider);
    const broker = await createZGComputeNetworkBroker(wallet as never);
    const providerAddress = this.config.providerAddress ?? await this.firstChatbotProvider(broker);
    await broker.inference.acknowledgeProviderSigner(providerAddress);
    await broker.inference.startAutoFunding(providerAddress, {
      bufferMultiplier: this.config.autoFundBufferMultiplier ?? 1,
    });
    const metadata = await broker.inference.getServiceMetadata(providerAddress);
    this.selection = {
      broker,
      providerAddress,
      endpoint: metadata.endpoint,
      model: metadata.model,
    };
    return this.selection;
  }

  async signedHeaders(content: string): Promise<Record<string, string>> {
    const service = await this.selectService();
    return service.broker.inference.getRequestHeaders(
      service.providerAddress,
      content,
    ) as unknown as Record<string, string>;
  }

  async processResponse(chatId: string | undefined, content: string): Promise<boolean | null> {
    const service = await this.selectService();
    return service.broker.inference.processResponse(service.providerAddress, chatId, content);
  }

  private async firstChatbotProvider(
    broker: Awaited<ReturnType<typeof createZGComputeNetworkBroker>>,
  ): Promise<string> {
    const services = await broker.inference.listService();
    const service = services.find((candidate: unknown) => {
      const record = candidate as Record<string, unknown>;
      return record.serviceType === "chatbot" || record.serviceType === "inference";
    }) as Record<string, unknown> | undefined;
    const address = service?.providerAddress ?? service?.address ?? service?.provider ?? service?.serviceProvider;
    if (typeof address !== "string" || !address) {
      throw new Error("No 0G chatbot provider found; set ZERO_G_PROVIDER_ADDRESS explicitly");
    }
    return address;
  }
}
