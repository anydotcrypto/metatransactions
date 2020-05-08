import { Wallet } from "ethers";
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
   * Create a new instance of the forwarder
   * @param chainid MAINNET or ROPSTEN
   * @param replayProtectionType Replay Protection
   * @param signer Signer's wallet
   */
  public abstract createNew(
    chainid: ChainID,
    replayProtectionType: ReplayProtectionType,
    signer: Wallet
  ): D;

  /**
   * Fetch a pre-configured replay protection
   * @param signer Signer's wallet
   * @param forwarderAddress Forwarder address
   * @param replayProtectionType Replay Protection
   */
  protected getReplayProtection(
    signer: Wallet,
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
