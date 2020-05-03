import { keccak256, arrayify, defaultAbiCoder } from "ethers/utils";
import { Wallet } from "ethers/wallet";
import { ReplayProtectionAuthority } from "./replayprotectionauthority";
import { RelayHub, ChainID } from "..";
import {
  ForwardParams,
  DeploymentParams,
  RelayCallData,
  Forwarder,
} from "./forwarder";

/**
 * A single library for approving meta-transactions and its associated
 * replay protection. All contracts must support the msgSender() standard.
 */
export class RelayHubForwarder extends Forwarder<RelayCallData> {
  /**
   * Sets up the RelayHub Forwarder that relies on the msgSender() standard.
   * It can only be used for a single wallet.
   * @param chainID MAINNET or ROPSTEN
   * @param relayHub RelayHub
   * @param signer Signer's wallet
   * @param replayProtectionAuthority Extends implementation ReplayProtectionAuthority
   */
  constructor(
    chainID: ChainID,
    relayHub: RelayHub,
    signer: Wallet,
    replayProtectionAuthority: ReplayProtectionAuthority
  ) {
    super(chainID, relayHub, signer, replayProtectionAuthority);
  }

  /**
   * Standard encoding for contract call data
   * @param data Target contract and the desired calldata
   */
  protected getEncodedCallData(data: RelayCallData) {
    return defaultAbiCoder.encode(
      ["address", "bytes"],
      [data.target, data.callData]
    );
  }

  /**
   * Fetch forward parameters
   * @param to RelayHub contract
   * @param data Target contract, value and calldata
   * @param replayProtection Encoded Replay Protection
   * @param replayProtectionAuthority Replay Protection Authority
   * @param signature Signature
   */
  protected getForwardParams(
    to: string,
    data: RelayCallData,
    replayProtection: string,
    signature: string
  ): ForwardParams {
    return {
      to,
      signer: this.signer.address,
      target: data.target,
      value: "0",
      data: data.callData,
      replayProtection,
      replayProtectionAuthority: this.replayProtectionAuthority.getAddress(),
      chainId: this.chainID,
      signature,
    };
  }

  /**
   * Encodes the meta-transaction such that it can be included
   * in the data field of an Ethereum Transaction
   * @param params Forward Parameters
   */
  public async encodeSignedMetaTransaction(
    params: ForwardParams
  ): Promise<string> {
    return this.forwarder.interface.functions.forward.encode([
      params.target,
      params.data,
      params.replayProtection,
      params.replayProtectionAuthority,
      params.signer,
      params.signature,
    ]);
  }

  /**
   * Helper function when signing a new meta-transaction
   */
  public async getForwarderAddress(): Promise<string> {
    return this.forwarder.address;
  }
}
