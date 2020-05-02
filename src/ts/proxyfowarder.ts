import {
  keccak256,
  arrayify,
  defaultAbiCoder,
  solidityKeccak256,
} from "ethers/utils";
import { Wallet } from "ethers/wallet";
import { ReplayProtectionAuthority } from "./replayprotectionauthority";
import { ChainID, ProxyAccountDeployer, ProxyAccountFactory } from "..";
import { ForwardParams, Forwarder, ProxyCallData } from "./forwarder";
import { DeploymentParams } from "./forwarder";

/**
 * A single library for approving meta-transactions and its associated
 * replay protection. All meta-transactions are sent via proxy contracts.
 */
export class ProxyForwarder extends Forwarder<ProxyCallData> {
  public getOnchainAddress(): Promise<string> {
    throw new Error("Method not implemented.");
  }
  /**
   * All meta-transactions are sent via an proxy contract.
   * @param chainID Chain ID
   * @param proxyHub Address of contract
   * @param signer Signer's wallet
   * @param replayProtectionAuthority Extends implementation ReplayProtectionAuthority
   */
  constructor(
    chainID: ChainID,
    proxyHub: ProxyAccountDeployer,
    signer: Wallet,
    replayProtectionAuthority: ReplayProtectionAuthority
  ) {
    super(chainID, proxyHub, signer, replayProtectionAuthority);
  }

  /**
   * Standard encoding for contract call data
   * @param data The target contract, value (wei) to send, and the calldata to execute in the target contract
   */
  protected getEncodedCallData(data: ProxyCallData) {
    // ProxyAccounts have a "value" field.
    return defaultAbiCoder.encode(
      ["address", "uint", "bytes"],
      [data.target, data.value, data.callData]
    );
  }

  /**
   * Returns the encoded calldata for creating a proxy contract
   * No need for ForwardParams as no signature is required in ProxyAccountDeployer
   */
  public async createProxyContract() {
    const deployed = await this.forwarder
      .connect(this.signer)
      .accounts(this.signer.address);

    // Does the user have a proxy contract?
    if (deployed === "0x0000000000000000000000000000000000000000") {
      const callData = this.forwarder.interface.functions.createProxyAccount.encode(
        [this.signer.address]
      );

      return callData;
    }

    throw new Error(
      "ProxyAccount for " + this.signer.address + " already exists."
    );
  }

  /**
   * Takes care of replay protection and signs a meta-transaction.
   * @param data Target contract address, value (wei) to send, and the calldata to exeucte in the target contract
   */
  public async signMetaTransaction(data: ProxyCallData) {
    const proxyAddr = await this.getProxyAddress();

    const encodedReplayProtection = await this.replayProtectionAuthority.getEncodedReplayProtection();

    const encodedCallData = this.getEncodedCallData(data);

    const encodedMetaTx = this.encodeMetaTransactionToSign(
      encodedCallData,
      encodedReplayProtection,
      this.replayProtectionAuthority.getAddress(),
      proxyAddr
    );

    const signature = await this.signer.signMessage(
      arrayify(keccak256(encodedMetaTx))
    );

    const params: ForwardParams = {
      to: proxyAddr,
      signer: this.signer.address,
      target: data.target,
      value: data.value.toString(),
      data: data.callData,
      replayProtection: encodedReplayProtection,
      replayProtectionAuthority: this.replayProtectionAuthority.getAddress(),
      chainId: this.chainID,
      signature: signature,
    };

    return params;
  }

  /**
   * ProxyAccount address for this signer
   * Caution: Contract may not be deployed yet.
   */
  public async getProxyAddress() {
    const baseAddress = await this.forwarder.baseAccount();
    return ProxyForwarder.buildCreate2Address(
      this.forwarder.address,
      this.signer.address,
      baseAddress
    );
  }

  /**
   * Encodes the forward parameters such that it can be included in
   * an Ethereum Transaction's data field.
   * @param params Forward Parameters
   */
  public async encodeSignedMetaTransaction(
    params: ForwardParams
  ): Promise<string> {
    const proxyAccount = new ProxyAccountFactory(this.signer).attach(params.to);

    return proxyAccount.interface.functions.forward.encode([
      params.target,
      params.value,
      params.data,
      params.replayProtection,
      params.replayProtectionAuthority,
      params.signature,
    ]);
  }

  /**
   * Signs a meta-transaction to deploy a contract via CREATE2.
   * Takes care of replay protection.
   * @param initCode Bytecode for the smart contract
   */
  public async signMetaDeployment(initCode: string) {
    const proxyAddr = await this.getProxyAddress();

    const encodedReplayProtection = await this.replayProtectionAuthority.getEncodedReplayProtection();

    const encodedMetaTx = this.encodeMetaTransactionToSign(
      initCode,
      encodedReplayProtection,
      this.replayProtectionAuthority.getAddress(),
      proxyAddr
    );

    const signature = await this.signer.signMessage(
      arrayify(keccak256(encodedMetaTx))
    );

    const params: DeploymentParams = {
      to: proxyAddr,
      signer: this.signer.address,
      data: initCode,
      replayProtection: encodedReplayProtection,
      replayProtectionAuthority: this.replayProtectionAuthority.getAddress(),
      chainId: this.chainID,
      signature: signature,
    };

    return params;
  }

  /**
   * Computes the proxy contract account.
   * Thanks to _prestwich for his pseudocode, got it to work!
   * @param creatorAddress Creator of the clone contract (ProxyAccountFactory)
   * @param signersAddress Signer's address
   * @param cloneAddress Contract to clone address
   */
  public static buildCreate2Address(
    creatorAddress: string,
    signersAddress: string,
    cloneAddress: string
  ) {
    const saltHex = solidityKeccak256(["address"], [signersAddress]);
    const byteCodeHash = solidityKeccak256(
      ["bytes", "bytes20", "bytes"],
      [
        "0x3d602d80600a3d3981f3363d3d373d3d3d363d73",
        cloneAddress,
        "0x5af43d82803e903d91602b57fd5bf3",
      ]
    );

    return `0x${keccak256(
      `0x${["ff", creatorAddress, saltHex, byteCodeHash]
        .map((x) => x.replace(/0x/, ""))
        .join("")}`
    ).slice(-40)}`;
  }
}
