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
  public async getOnchainAddress(): Promise<string> {
    return this.signer.address;
  }
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
   * Easy method for signing a meta-transaction. Takes care of replay protection.]
   * @param data target: contractAddress, callData
   */
  public async signMetaTransaction(data: RelayCallData) {
    const encodedReplayProtection = await this.replayProtectionAuthority.getEncodedReplayProtection();

    const encodedCallData = this.getEncodedCallData(data);
    const encodedMetaTx = this.encodeMetaTransactionToSign(
      encodedCallData,
      encodedReplayProtection,
      this.replayProtectionAuthority.getAddress(),
      this.forwarder.address
    );

    const signature = await this.signer.signMessage(
      arrayify(keccak256(encodedMetaTx))
    );

    const params: ForwardParams = {
      to: this.forwarder.address,
      signer: this.signer.address,
      target: data.target,
      value: "0",
      data: data.callData,
      replayProtection: encodedReplayProtection,
      replayProtectionAuthority: this.replayProtectionAuthority.getAddress(),
      chainId: this.chainID,
      signature: signature,
    };

    return params;
  }

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
   * Easy method for deploying a contract via meta-transaction.
   * Takes care of replay protection.
   * @param initCode Bytecode for the smart contract
   */
  public async signMetaDeployment(initCode: string) {
    const encodedReplayProtection = await this.replayProtectionAuthority.getEncodedReplayProtection();

    const encodedMetaTx = this.encodeMetaTransactionToSign(
      initCode,
      encodedReplayProtection,
      this.replayProtectionAuthority.getAddress(),
      this.forwarder.address
    );

    const signature = await this.signer.signMessage(
      arrayify(keccak256(encodedMetaTx))
    );

    const params: DeploymentParams = {
      to: this.forwarder.address,
      signer: this.signer.address,
      data: initCode,
      replayProtection: encodedReplayProtection,
      replayProtectionAuthority: this.replayProtectionAuthority.getAddress(),
      chainId: this.chainID,
      signature: signature,
    };

    return params;
  }
}
