import { Signer } from "ethers";
import { ReplayProtectionAuthority } from "../replayProtection/replayProtectionAuthority";
import { MultiNonceReplayProtection, BitFlipReplayProtection } from "../..";

export enum ReplayProtectionType {
  BITFLIP,
  MULTINONCE,
  NONCE,
}

export enum ChainID {
  MAINNET = 1,
  ROPSTEN = 3,
}

export abstract class ForwarderFactory<D> {
  /**
   * Create a new instance of the forwarder. When a forwarder is created it is cached
   * for the combination of chainId, replayProtectionType and signer.address. Subsequent calls to create
   * with the same parameters will return the same forwarder instance.
   * @param chainId MAINNET or ROPSTEN
   * @param replayProtectionType Replay Protection
   * @param signer Signer's wallet
   */
  public async createNew(
    chainId: ChainID,
    replayProtectionType: ReplayProtectionType,
    signer: Signer
  ) {
    const cacheId = await this.getCacheId(
      chainId,
      replayProtectionType,
      signer
    );
    const cachedForwarder = this.getCachedForwarder(cacheId);
    return (
      cachedForwarder ||
      (await this.createInternal(chainId, replayProtectionType, signer))
    );
  }

  protected async getCacheId(
    chainid: ChainID,
    replayProtectionType: ReplayProtectionType,
    signer: Signer
  ) {
    return `${chainid}:${replayProtectionType}:${await signer.getAddress()}`;
  }

  protected abstract getCachedForwarder(cacheId: string): D | undefined;
  protected abstract cacheForwarder(cacheId: string, forwarder: D): void;

  protected async createInternal(
    chainid: ChainID,
    replayProtectionType: ReplayProtectionType,
    signer: Signer
  ): Promise<D> {
    const forwarder = await this.createInternal(
      chainid,
      replayProtectionType,
      signer
    );
    const cacheId = await this.getCacheId(
      chainid,
      replayProtectionType,
      signer
    );
    this.cacheForwarder(cacheId, forwarder);
    return forwarder;
  }

  /**
   * Fetch a pre-configured replay protection
   * @param signer Signer's wallet
   * @param forwarderAddress Forwarder address
   * @param replayProtectionType Replay Protection
   */
  protected getReplayProtection(
    signer: Signer,
    forwarderAddress: string,
    replayProtectionType: ReplayProtectionType
  ): ReplayProtectionAuthority {
    if (replayProtectionType == ReplayProtectionType.MULTINONCE) {
      return new MultiNonceReplayProtection(30, signer, forwarderAddress);
    }

    if (replayProtectionType == ReplayProtectionType.BITFLIP) {
      return new BitFlipReplayProtection(signer, forwarderAddress);
    }

    return new MultiNonceReplayProtection(1, signer, forwarderAddress);
  }
}
