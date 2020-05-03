import { Wallet } from "ethers/wallet";
import { MultiNonce } from "./multinonce";
import { BitFlip } from "./bitflip";
import { ProxyAccountForwarder } from "./proxyaccountfowarder";
import { RelayHubFactory } from "../typedContracts/RelayHubFactory";
import { RelayHubForwarder } from "./relayforwarder";
import { ProxyAccountDeployerFactory } from "..";
import { ReplayProtectionAuthority } from "./replayprotectionauthority";

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

/**
 * A single library for approving meta-transactions and its associated
 * replay protection.
 */
export class ForwarderFactory {
  protected static getForwarderAddress(
    chainid: ChainID,
    forwarderType: ForwarderType
  ) {
    if (chainid === ChainID.MAINNET) {
      if (forwarderType === ForwarderType.RELAYHUB) {
        return "0x7915DCbe8E2b132832c63E0704D9EBBbD5800dd8" as string;
      }

      if (forwarderType === ForwarderType.PROXYACCOUNTDEPLOYER) {
        return "0x894CEd16b2710B90763e7daa83829fec7Ebd31E9" as string;
      }
    }

    if (chainid === ChainID.ROPSTEN) {
      if (forwarderType === ForwarderType.RELAYHUB) {
        return "0xdFaed94BCDbe2Ca6399F78621925AD1D5b851750" as string;
      }

      if (forwarderType === ForwarderType.PROXYACCOUNTDEPLOYER) {
        return "0xc9d6292CA60605CB2d443a5395737a307E417E53" as string;
      }
    }
    throw new Error("Please specify a valid ChainID and ContractType");
  }

  /**
   * A pre-configuration of a proxy forwarder.
   * Dedicated to a single wallet.
   * @param chainid MAINNET or ROPSTEN
   * @param replayProtectionType BITFLIP, MULTINONCE OR NONCE
   * @param signer Signer's wallet
   */
  public static async getProxyForwarder(
    chainid: ChainID,
    replayProtectionType: ReplayProtectionType,
    signer: Wallet
  ) {
    const addr = this.getForwarderAddress(
      chainid,
      ForwarderType.PROXYACCOUNTDEPLOYER
    );

    const proxyHub = new ProxyAccountDeployerFactory(signer).attach(addr);
    const baseAccount = await proxyHub.baseAccount();
    const proxyAddress = ProxyAccountForwarder.buildCreate2Address(
      proxyHub.address,
      signer.address,
      baseAccount
    );

    return new ProxyAccountForwarder(
      chainid,
      proxyHub,
      signer,
      ForwarderFactory.getReplayProtection(
        signer,
        proxyAddress,
        replayProtectionType
      )
    );
  }

  /**
   * Fetch a pre-configured replay protection
   * @param signer Signer's wallet
   * @param forwarderAddress Forwarder address
   * @param replayProtectionType Replay Protection
   */
  protected static getReplayProtection(
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

  /**
   * A pre-configuration of a relayhub forwarder.
   * Dedicated to a single wallet.
   * @param chainid MAINNET or ROPSTEN
   * @param replayProtectionType BITFLIP, MULTINONCE OR NONCE
   * @param signer Signer's wallet
   */
  public static getRelayHubForwarder(
    chainid: ChainID,
    replayProtectionType: ReplayProtectionType,
    signer: Wallet
  ) {
    const addr = this.getForwarderAddress(chainid, ForwarderType.RELAYHUB);

    const relayHub = new RelayHubFactory(signer).attach(addr);

    return new RelayHubForwarder(
      chainid,
      relayHub,
      signer,
      ForwarderFactory.getReplayProtection(
        signer,
        relayHub.address,
        replayProtectionType
      )
    );
  }
}
