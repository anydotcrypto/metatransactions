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

export enum ForwarderType {
  ProxyAccount = 1,
  RelayHub = 2,
}

export abstract class ForwarderFactory<D> {
  protected constructor(private readonly type: ForwarderType) {}

  // we use 'any' here since a static prop cant have access
  // to the instance types eg. ProxyAccountForwarderFactory
  private static cache: Map<string, any> = new Map();

  protected async getCacheId(
    chainid: ChainID,
    replayProtectionType: ReplayProtectionType,
    signer: Signer
  ) {
    return `${
      this.type
    }:${chainid}:${replayProtectionType}:${await signer.getAddress()}`;
  }

  /**
   * Create a new instance of the forwarder. When a forwarder is created it is cached
   * for the combination of chainId, replayProtectionType and signer.address. Subsequent calls to create
   * with the same parameters will return the same forwarder instance.
   * @param chainId MAINNET or ROPSTEN
   * @param replayProtectionType Replay Protection
   * @param signer Signer's wallet
   */
  public async create(
    chainId: ChainID,
    replayProtectionType: ReplayProtectionType,
    signer: Signer
  ): Promise<D> {
    const cacheId = await this.getCacheId(
      chainId,
      replayProtectionType,
      signer
    );

    if (!ForwarderFactory.cache.get(cacheId)) {
      const forwarder = await this.createNew(
        chainId,
        replayProtectionType,
        signer
      );
      // always check before setting in the cache
      // since we aren locking above
      if (!ForwarderFactory.cache.get(cacheId)) {
        ForwarderFactory.cache.set(cacheId, forwarder);
      }
    }

    // creating the forwarder is async, so multiple forwarders may be created here
    // so always pull the forwarder out of the cache to avoid race conditions during creation
    return ForwarderFactory.cache.get(cacheId);
  }

  /**
   * Create a new instance of the forwarder. Does not access the forwarder cache, and does not store this forwarder there
   * @param chainId MAINNET or ROPSTEN
   * @param replayProtectionType Replay Protection
   * @param signer Signer's wallet
   */
  public abstract async createNew(
    chainid: ChainID,
    replayProtectionType: ReplayProtectionType,
    signer: Signer
  ): Promise<D>;

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
