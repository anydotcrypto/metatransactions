import { Wallet } from "ethers/wallet";
import { MultiNonce } from "./multinonce";
import { BitFlip } from "./bitflip";
import { ProxyForwarder } from "./proxyfowarder";
import { RelayHubFactory } from "../typedContracts/RelayHubFactory";
import { RelayHubForwarder } from "./relayforwarder";
import { Contract } from "ethers";
import { ProxyAccountDeployerFactory } from "..";

export enum ForwarderType {
  RELAYHUB,
  PROXYACCOUNT,
  PROXYHUB,
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
export class MetaTxHandler {
  public static getForwarderAddress(
    chainid: ChainID,
    forwarderType: ForwarderType
  ) {
    if (chainid === ChainID.MAINNET) {
      if (forwarderType === ForwarderType.RELAYHUB) {
        return "0x7915DCbe8E2b132832c63E0704D9EBBbD5800dd8" as string;
      }

      if (forwarderType === ForwarderType.PROXYHUB) {
        return "0x894CEd16b2710B90763e7daa83829fec7Ebd31E9" as string;
      }
    }

    if (chainid === ChainID.ROPSTEN) {
      if (forwarderType === ForwarderType.RELAYHUB) {
        return "0xdFaed94BCDbe2Ca6399F78621925AD1D5b851750" as string;
      }

      if (forwarderType === ForwarderType.PROXYHUB) {
        return "0xc9d6292CA60605CB2d443a5395737a307E417E53" as string;
      }
    }
    throw new Error("Please specify a valid ChainID and ContractType");
  }

  /**
   * A pre-configuration of a proxy forwarder.
   * Dedicated to a single wallet.
   * @param chainid MAINNET or ROPSTEN
   * @param replayProtectionAuth BITFLIP, MULTINONCE OR NONCE
   * @param signer Signer's wallet
   */
  public static async getProxyForwarder(
    chainid: ChainID,
    replayProtectionAuth: ReplayProtectionType,
    signer: Wallet
  ) {
    const addr = this.getForwarderAddress(chainid, ForwarderType.PROXYHUB);

    const proxyHub = new ProxyAccountDeployerFactory(signer).attach(addr);
    const baseAccount = await proxyHub.baseAccount();
    const proxyAddress = ProxyForwarder.buildCreate2Address(
      proxyHub.address,
      signer.address,
      baseAccount
    );

    if (replayProtectionAuth == ReplayProtectionType.BITFLIP) {
      return new ProxyForwarder(
        chainid,
        proxyHub,
        signer,
        new BitFlip(signer, proxyAddress)
      );
    }

    if (replayProtectionAuth == ReplayProtectionType.MULTINONCE) {
      return new ProxyForwarder(
        chainid,
        proxyHub,
        signer,
        new MultiNonce(30, signer, proxyAddress)
      );
    }

    return new ProxyForwarder(
      chainid,
      proxyHub,
      signer,
      new MultiNonce(1, signer, proxyAddress)
    );
  }

  /**
   * A pre-configuration of a relayhub forwarder.
   * Dedicated to a single wallet.
   * @param chainid MAINNET or ROPSTEN
   * @param replayProtectionAuth BITFLIP, MULTINONCE OR NONCE
   * @param signer Signer's wallet
   */
  public static getRelayHubForwarder(
    chainid: ChainID,
    replayProtectionAuth: ReplayProtectionType,
    signer: Wallet
  ) {
    const addr = this.getForwarderAddress(chainid, ForwarderType.RELAYHUB);

    const relayHub = new RelayHubFactory(signer).attach(addr);
    if (replayProtectionAuth == ReplayProtectionType.BITFLIP) {
      return new RelayHubForwarder(
        chainid,
        relayHub,
        signer,
        new BitFlip(signer, relayHub.address)
      );
    }

    if (replayProtectionAuth == ReplayProtectionType.MULTINONCE) {
      return new RelayHubForwarder(
        chainid,
        relayHub,
        signer,
        new MultiNonce(30, signer, relayHub.address)
      );
    }

    return new RelayHubForwarder(
      chainid,
      relayHub,
      signer,
      new MultiNonce(1, signer, relayHub.address)
    );
  }

  /**
   * Unfortunately, instanceof does not work when compiled
   * to javascript. In order to detect if the hub is a ProxyAccount,
   * RelayHub or ProxyAccountFactory - we rely on checking the existance of a
   * function.
   * - init() is only available in a ProxyAccount
   * - accounts() is only available in a ProxyAccountFactory
   * If neither function is detected, we assume it is a RelayHub.
   * @param hub Contract
   */
  public static getContractType(contract: Contract) {
    if (contract.init) {
      return ForwarderType.PROXYACCOUNT;
    }

    if (contract.accounts) {
      return ForwarderType.PROXYHUB;
    }

    return ForwarderType.RELAYHUB;
  }
}
