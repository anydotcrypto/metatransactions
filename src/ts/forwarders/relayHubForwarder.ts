import { defaultAbiCoder } from "ethers/utils";
import { ReplayProtectionAuthority } from "../replayProtection/replayProtectionAuthority";
import { RelayHub, ChainID, RelayHubFactory } from "../..";
import {
  ForwardParams,
  RelayHubCallData,
  Forwarder,
  DeploymentParams,
  RequiredTo,
} from "./forwarder";
import { Signer } from "ethers";

/**
 * A single library for approving meta-transactions and its associated
 * replay protection. All contracts must support the msgSender() standard.
 */
export class RelayHubForwarder extends Forwarder<RelayHubCallData> {
  private relayHub: RelayHub;
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
    signer: Signer,
    relayHubAddress: string,
    replayProtectionAuthority: ReplayProtectionAuthority
  ) {
    super(chainID, signer, relayHubAddress, replayProtectionAuthority);
    this.relayHub = new RelayHubFactory(signer).attach(relayHubAddress);
  }

  /**
   * Standard encoding for contract call data
   * @param data Target contract and the desired calldata
   */
  protected getEncodedCallData(data: RequiredTo<RelayHubCallData>) {
    return defaultAbiCoder.encode(["address", "bytes"], [data.to, data.data]);
  }

  /**
   * Fetch forward parameters
   * @param to RelayHub contract
   * @param data Target contract, value and calldata
   * @param replayProtection Encoded Replay Protection
   * @param replayProtectionAuthority Replay Protection Authority
   * @param signature Signature
   */
  protected async getForwardParams(
    to: string,
    data: RequiredTo<RelayHubCallData>,
    replayProtection: string,
    signature: string
  ): Promise<ForwardParams> {
    return {
      to,
      signer: await this.signer.getAddress(),
      target: data.to,
      value: "0",
      data: data.data,
      replayProtection,
      replayProtectionAuthority: this.replayProtectionAuthority.address,
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
    return this.relayHub.interface.functions.forward.encode([
      params.target,
      params.data,
      params.replayProtection,
      params.replayProtectionAuthority,
      params.signer,
      params.signature,
    ]);
  }

  /**
   * Encodes the meta-deployment such that it can be included
   * in the data field of an Ethereum transaction
   * @param params Deployment parameters
   */
  public async encodeSignedMetaDeployment(
    params: DeploymentParams
  ): Promise<string> {
    return this.relayHub.interface.functions.deployContract.encode([
      params.initCode,
      params.replayProtection,
      params.replayProtectionAuthority,
      params.signer,
      params.signature,
    ]);
  }

  /**
   * Helper function when signing a new meta-transaction
   */
  public async getAddress(): Promise<string> {
    return this.relayHub.address;
  }
}
