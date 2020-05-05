import { keccak256, defaultAbiCoder, solidityKeccak256 } from "ethers/utils";
import { Wallet } from "ethers/wallet";
import { ReplayProtectionAuthority } from "../replayprotection/replayprotectionauthority";
import { ChainID, ProxyAccountDeployer, ProxyAccountFactory } from "../..";
import {
  ForwardParams,
  Forwarder,
  ProxyCallData,
  DeploymentParams,
} from "./forwarder";
import { Create2Options, getCreate2Address } from "ethers/utils/address";

export interface CreateProxyData {
  to: string;
  callData: string;
}
/**
 * A single library for approving meta-transactions and its associated
 * replay protection. All meta-transactions are sent via proxy contracts.
 */
export class ProxyAccountForwarder extends Forwarder<ProxyCallData> {
  private baseAccount: string;
  /**
   * All meta-transactions are sent via an proxy contract.
   * @param chainID Chain ID
   * @param proxyDeployer Address of contract
   * @param signer Signer's wallet
   * @param replayProtectionAuthority Extends implementation ReplayProtectionAuthority
   */
  constructor(
    chainID: ChainID,
    private readonly proxyDeployer: ProxyAccountDeployer,
    signer: Wallet,
    replayProtectionAuthority: ReplayProtectionAuthority
  ) {
    super(chainID, signer, replayProtectionAuthority);
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
   * Checks if the ProxyContract is already deployed.
   * @returns TRUE if deployed, FALSE if not deployed.
   */
  public async isProxyContractDeployed(): Promise<boolean> {
    const deployed = await this.proxyDeployer
      .connect(this.signer)
      .accounts(this.signer.address);

    // Does the user have a proxy contract?
    if (deployed === "0x0000000000000000000000000000000000000000") {
      return false;
    }

    return true;
  }
  /**
   * Returns the encoded calldata for creating a proxy contract
   * No need for ForwardParams as no signature is required in ProxyAccountDeployer
   * @returns The proxy deployer address and the calldata for creating proxy account
   * @throws If the proxy account already exists
   */
  public async createProxyContract(): Promise<CreateProxyData> {
    const callData = this.proxyDeployer.interface.functions.createProxyAccount.encode(
      [this.signer.address]
    );

    return { to: this.proxyDeployer.address, callData };
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
   * Encodes the meta-deployment such that it can be included
   * in the data field of an Ethereum transaction.
   * @param params Deployment parameters
   * @throws ProxyAccount contract must already be deployed  on-chain.
   */
  public async encodeSignedMetaDeployment(
    params: DeploymentParams
  ): Promise<string> {
    const proxyAccount = new ProxyAccountFactory(this.signer).attach(params.to);

    return proxyAccount.interface.functions.deployContract.encode([
      params.initCode,
      params.replayProtection,
      params.replayProtectionAuthority,
      params.signature,
    ]);
  }

  /**
   * Fetch forward parameters
   * @param to ProxyAccount contract
   * @param data Target contract, value and calldata
   * @param replayProtection Encoded Replay Protection
   * @param replayProtectionAuthority Replay Protection Authority
   * @param signature Signature
   */
  protected getForwardParams(
    to: string,
    data: ProxyCallData,
    replayProtection: string,
    signature: string
  ): ForwardParams {
    return {
      to,
      signer: this.signer.address,
      target: data.target,
      value: data.value.toString(),
      data: data.callData,
      replayProtection,
      replayProtectionAuthority: this.replayProtectionAuthority.getAddress(),
      chainId: this.chainID,
      signature,
    };
  }

  /**
   * Computes the proxy contract account.
   * @param creatorAddress Creator of the clone contract (ProxyAccountDeployer)
   * @param signersAddress Signer's address
   * @param cloneAddress Contract to clone address
   */
  public async getAddress(): Promise<string> {
    if (!this.baseAccount) {
      this.baseAccount = await this.proxyDeployer.baseAccount();
    }
    return ProxyAccountForwarder.buildProxyAccountAddress(
      this.proxyDeployer.address,
      this.signer.address,
      this.baseAccount
    );
  }

  /**
   * Computes the proxy contract account.
   * @param creatorAddress Creator of the clone contract (ProxyAccountDeployer)
   * @param signersAddress Signer's address
   * @param cloneAddress Contract to clone address
   */
  public static buildProxyAccountAddress(
    creatorAddress: string,
    signersAddress: string,
    baseAccount: string
  ): string {
    const saltHex = solidityKeccak256(["address"], [signersAddress]);
    const byteCodeHash = solidityKeccak256(
      ["bytes", "bytes20", "bytes"],
      [
        "0x3d602d80600a3d3981f3363d3d373d3d3d363d73",
        baseAccount,
        "0x5af43d82803e903d91602b57fd5bf3",
      ]
    );
    const options: Create2Options = {
      from: creatorAddress,
      salt: saltHex,
      initCodeHash: byteCodeHash,
    };

    return getCreate2Address(options);
  }
}
