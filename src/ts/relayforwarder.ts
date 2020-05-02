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
 * replay protection.
 */
export class RelayHubForwarder extends Forwarder<RelayCallData> {
  /**
   * Sets up a MetaTxHandler with the desired ReplayProtection Authority.
   * @param relayHub RelayHub
   * @param replayProtectionAuthority Extends implementation ReplayProtectionAuthority
   */
  constructor(
    chainID: ChainID,
    relayHub: RelayHub,
    replayProtectionAuthority: ReplayProtectionAuthority
  ) {
    super(chainID, relayHub, replayProtectionAuthority);
  }

  /**
   * Standard encoding for contract call data
   * @param target Target contract
   * @param callData Encoded function call with data
   */
  protected getEncodedCallData(data: RelayCallData) {
    return defaultAbiCoder.encode(
      ["address", "bytes"],
      [data.target, data.callData]
    );
  }

  /**
   * Easy method for signing a meta-transaction. Takes care of replay protection.]
   * @param signer Signer's wallet
   * @param data target: contractAddress, callData
   */
  public async signMetaTransaction(signer: Wallet, data: RelayCallData) {
    const encodedReplayProtection = await this.replayProtectionAuthority.getEncodedReplayProtection(
      signer,
      this.forwarder.address
    );

    const encodedCallData = this.getEncodedCallData(data);
    const encodedMetaTx = this.encodeMetaTransactionToSign(
      encodedCallData,
      encodedReplayProtection,
      this.replayProtectionAuthority.getAddress(),
      this.forwarder.address
    );

    const signature = await signer.signMessage(
      arrayify(keccak256(encodedMetaTx))
    );

    const params: ForwardParams = {
      to: this.forwarder.address,
      signer: signer.address,
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
    params: ForwardParams,
    wallet: Wallet
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
   * @param signer Signer's wallet
   * @param initCode Bytecode for the smart contract
   */
  public async signMetaDeployment(signer: Wallet, initCode: string) {
    const encodedReplayProtection = await this.replayProtectionAuthority.getEncodedReplayProtection(
      signer,
      this.forwarder.address
    );

    const encodedMetaTx = this.encodeMetaTransactionToSign(
      initCode,
      encodedReplayProtection,
      this.replayProtectionAuthority.getAddress(),
      this.forwarder.address
    );

    const signature = await signer.signMessage(
      arrayify(keccak256(encodedMetaTx))
    );

    const params: DeploymentParams = {
      to: this.forwarder.address,
      signer: signer.address,
      data: initCode,
      replayProtection: encodedReplayProtection,
      replayProtectionAuthority: this.replayProtectionAuthority.getAddress(),
      chainId: this.chainID,
      signature: signature,
    };

    return params;
  }
}
