import { Wallet } from "ethers";
import { ReplayProtectionAuthority } from "../replayprotection/replayprotectionauthority";
import { MultiNonce, BitFlip } from "../..";

export enum ForwarderType {
  RELAYHUB,
  PROXYACCOUNT,
  PROXYACCOUNTDEPLOYER,
}

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
  public abstract async createNew(
    chainid: ChainID,
    replayProtectionType: ReplayProtectionType,
    signer: Wallet
  ): Promise<D>;

  /**
   * Fetch address of the forwarder
   * @param chainid MAINNET or ROPSTEN
   */
  public abstract getDeployedForwarderAddress(chainid: ChainID): string;

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
      return new MultiNonce(30, signer, forwarderAddress);
    }

    if (replayProtectionType == ReplayProtectionType.BITFLIP) {
      return new BitFlip(signer, forwarderAddress);
    }

    return new MultiNonce(1, signer, forwarderAddress);
  }
}
