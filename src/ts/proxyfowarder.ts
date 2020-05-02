import {
  keccak256,
  arrayify,
  defaultAbiCoder,
  solidityKeccak256,
} from "ethers/utils";
import { Wallet } from "ethers/wallet";
import { ReplayProtectionAuthority } from "./replayprotectionauthority";
import { ProxyHub, ChainID } from "..";
import { ForwardParams, Forwarder, ProxyCallData } from "./forwarder";
import { DeploymentParams } from "./forwarder";
import { ProxyAccountFactory } from "../typedContracts/ProxyAccountFactory";

/**
 * A single library for approving meta-transactions and its associated
 * replay protection.
 */
export class ProxyForwarder extends Forwarder<ProxyCallData> {
  /**
   * Sets up a MetaTxHandler with the desired ReplayProtection Authority.
   * @param chainID Chain ID
   * @param proxyHub Address of contract
   * @param replayProtectionAuthority Extends implementation ReplayProtectionAuthority
   */
  constructor(
    chainID: ChainID,
    proxyHub: ProxyHub,
    replayProtectionAuthority: ReplayProtectionAuthority
  ) {
    super(chainID, proxyHub, replayProtectionAuthority);
  }

  /**
   * Standard encoding for contract call data
   * @param target Target contract
   * @param value Denominated in wei
   * @param callData Encoded function call with data
   */
  protected getEncodedCallData(data: ProxyCallData) {
    // ProxyAccounts have a "value" field.
    return defaultAbiCoder.encode(
      ["address", "uint", "bytes"],
      [data.target, data.value, data.callData]
    );
  }

  /**
   * Deploys a proxy contract for the user
   * @param wallet Wallet to sign Ethereum Transaction
   * @param userAddress User's Ethereum Account
   */
  public async createProxyContract(wallet: Wallet, userAddress: string) {
    const deployed = await this.forwarder.connect(wallet).accounts(userAddress);

    // Does the user have a proxy contract?
    if (deployed === "0x0000000000000000000000000000000000000000") {
      const tx = await this.forwarder
        .connect(wallet)
        .createProxyAccount(userAddress);

      return tx;
    }

    throw new Error("ProxyAccount for " + userAddress + " already exists.");
  }

  /**
   * Easy method for signing a meta-transaction. Takes care of replay protection.]
   * @param signer Signer's wallet
   * @param target Target contract address
   * @param value Value to send
   * @param callData Encoded calldata
   */
  public async signMetaTransaction(signer: Wallet, data: ProxyCallData) {
    const proxyAddr = await this.getProxyAddress(signer.address);

    const encodedReplayProtection = await this.replayProtectionAuthority.getEncodedReplayProtection(
      signer,
      proxyAddr
    );

    const encodedCallData = this.getEncodedCallData(data);

    const encodedMetaTx = this.encodeMetaTransactionToSign(
      encodedCallData,
      encodedReplayProtection,
      this.replayProtectionAuthority.getAddress(),
      proxyAddr
    );

    const signature = await signer.signMessage(
      arrayify(keccak256(encodedMetaTx))
    );

    const params: ForwardParams = {
      to: proxyAddr,
      signer: signer.address,
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

  public async getProxyAddress(signerAddress: string) {
    const baseAddress = await this.forwarder.baseAccount();
    return ProxyForwarder.buildCreate2Address(
      this.forwarder.address,
      signerAddress,
      baseAddress
    );
  }

  public async encodeSignedMetaTransaction(
    params: ForwardParams,
    wallet: Wallet
  ): Promise<string> {
    const proxyAccount = new ProxyAccountFactory(wallet).attach(params.to);

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
   * Easy method for deploying a contract via meta-transaction.
   * Takes care of replay protection.
   * @param signer Signer's wallet
   * @param initCode Bytecode for the smart contract
   */
  public async signMetaDeployment(signer: Wallet, initCode: string) {
    const proxyAddr = await this.getProxyAddress(signer.address);

    const encodedReplayProtection = await this.replayProtectionAuthority.getEncodedReplayProtection(
      signer,
      proxyAddr
    );

    const encodedMetaTx = this.encodeMetaTransactionToSign(
      initCode,
      encodedReplayProtection,
      this.replayProtectionAuthority.getAddress(),
      proxyAddr
    );

    const signature = await signer.signMessage(
      arrayify(keccak256(encodedMetaTx))
    );

    const params: DeploymentParams = {
      to: proxyAddr,
      signer: signer.address,
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
   * @param creatorAddress Creator of the clone contract (ProxyHub)
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
