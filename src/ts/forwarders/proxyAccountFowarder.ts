import {
  defaultAbiCoder,
  solidityKeccak256,
  Interface,
  arrayify,
  keccak256,
  BigNumberish,
} from "ethers/utils";

import { ReplayProtectionAuthority } from "../replayProtection/replayProtectionAuthority";
import {
  ChainID,
  ProxyAccountDeployer,
  ProxyAccountFactory,
  ProxyAccount,
} from "../..";
import {
  ForwardParams,
  Forwarder,
  MinimalTx,
  RequiredTo,
  CallType,
} from "./forwarder";
import { Create2Options, getCreate2Address } from "ethers/utils/address";
import { abi } from "../../typedContracts/ProxyAccount.json";

import { ProxyAccountDeployerFactory } from "../../typedContracts/ProxyAccountDeployerFactory";
import {
  PROXY_ACCOUNT_DEPLOYER_ADDRESS,
  BASE_ACCOUNT_ADDRESS,
} from "../../deployment/addresses";
import { Signer, Contract } from "ethers";

import { deployerAddress, deployerABI } from "../../deployment/deployer";

export interface ProxyAccountCallData {
  to: string;
  value?: BigNumberish;
  data?: string;
}

/**
 * A single library for approving meta-transactions and its associated
 * replay protection. All meta-transactions are sent via proxy contracts.
 */
export class ProxyAccountForwarder extends Forwarder<Partial<MinimalTx>> {
  private proxyDeployer: ProxyAccountDeployer;
  /**
   * All meta-transactions are sent via an proxy contract.
   * @param chainID Chain ID
   * @param proxyDeployer Address of contract
   * @param signer Signer's wallet
   * @param proxyAddress Proxy contract
   * @param replayProtectionAuthority Extends implementation ReplayProtectionAuthority
   */
  constructor(
    chainID: ChainID,
    proxyDeployerAddress: string,
    signer: Signer,
    address: string,
    replayProtectionAuthority: ReplayProtectionAuthority
  ) {
    super(chainID, signer, address, replayProtectionAuthority);
    this.proxyDeployer = new ProxyAccountDeployerFactory(signer).attach(
      proxyDeployerAddress
    );
  }

  /**
   * Standard encoding for contract call data
   * @param data The target contract, value (wei) to send, and the calldata to execute in the target contract
   */
  protected getEncodedCallData(data: RequiredTo<MinimalTx>) {
    // ProxyAccounts have a "value" field.
    return defaultAbiCoder.encode(
      ["uint", "address", "uint", "bytes"],
      [
        data.callType ? data.callType : CallType.CALL,
        data.to,
        data.value ? data.value : 0,
        data.data ? data.data : "0x",
      ]
    );
  }

  /**
   * Returns the encoded calldata for creating a proxy contract
   * No need for ForwardParams as no signature is required in ProxyAccountDeployer
   * @returns The proxy deployer address and the calldata for creating proxy account
   * @throws If the proxy account already exists
   */
  public async createProxyContract(): Promise<MinimalTx> {
    const callData = this.proxyDeployer.interface.functions.createProxyAccount.encode(
      [await this.signer.getAddress()]
    );

    // 115k gas inc the transaction cost.
    return {
      to: this.proxyDeployer.address,
      data: callData,
    };
  }

  /**
   * Encodes the forward parameters such that it can be included in
   * an Ethereum Transaction's data field.
   * @param params Forward Parameters
   */
  protected async encodeSignedMetaTransaction(
    params: ForwardParams
  ): Promise<string> {
    const proxyAccount = new ProxyAccountFactory(this.signer).attach(params.to);

    if (params.callType == CallType.DELEGATE) {
      return proxyAccount.interface.functions.delegate.encode([
        params.target,
        params.value,
        params.data,
        params.replayProtection,
        params.replayProtectionAuthority,
        params.signature,
      ]);
    }

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
   * Batches a list of transactions into a single meta-transaction.
   * It supports both meta-transactions & meta-deployment.
   * @param dataList List of transactions to batch
   */
  public async signAndEncodeBatchTransaction(dataList: MinimalTx[]) {
    // Separate out the calls to encode
    const to = [];
    const value = [];
    const callData = [];
    const callType = [];
    const revertOnFail = [];

    for (const data of dataList) {
      to.push(data.to!);
      value.push(data.value ? data.value : "0");
      callData.push(data.data ? data.data : "0x");
      callType.push(data.callType ? data.callType : CallType.CALL);
      revertOnFail.push(false);
    }

    // Prepare the meta-transaction & sign it
    const encodedReplayProtection = await this.replayProtectionAuthority.getEncodedReplayProtection();
    const encodedCallData = defaultAbiCoder.encode(
      ["uint", "address[]", "uint[]", "bytes[]", "bool[]", "uint[]"],
      [CallType.BATCH, to, value, callData, revertOnFail, callType]
    );
    const encodedMetaTx = this.encodeMetaTransactionToSign(
      encodedCallData,
      encodedReplayProtection,
      this.replayProtectionAuthority.getAddress()
    );

    const signature = await this.signer.signMessage(
      arrayify(keccak256(encodedMetaTx))
    );

    const proxyAccountInterface = new Interface(
      abi
    ) as ProxyAccount["interface"];

    const encodedBatch = proxyAccountInterface.functions.batch.encode([
      to,
      value,
      callData,
      revertOnFail,
      callType,
      encodedReplayProtection,
      this.replayProtectionAuthority.getAddress(),
      signature,
    ]);

    return { to: this.address, data: encodedBatch };
  }

  /**
   * Wraps the deployment inside a meta-transaction. It is deployed via a global
   * deployer (we set it as params.target).
   * @param initCode Initialisation code for the contract
   * @param extraData Extra data for the salt
   */
  public async signMetaDeployment(
    initCode: string,
    extraData: string
  ): Promise<ForwardParams> {
    const deployer = new Contract(deployerAddress, deployerABI, this.signer);

    const data = deployer.interface.functions.deploy.encode([
      initCode,
      keccak256(extraData),
    ]);

    const tx = { to: deployerAddress, data: data, callType: CallType.DELEGATE };

    return await this.signMetaTransaction(tx);
  }
  /**
   * Fetch forward parameters.
   * @param to ProxyAccount contract
   * @param data Target contract, value and calldata
   * @param replayProtection Encoded Replay Protection
   * @param replayProtectionAuthority Replay Protection Authority
   * @param signature Signature
   */
  protected async getForwardParams(
    to: string,
    data: RequiredTo<MinimalTx>,
    replayProtection: string,
    signature: string
  ): Promise<ForwardParams> {
    return {
      to,
      signer: await this.signer.getAddress(),
      target: data.to,
      value: data.value ? data.value.toString() : "0",
      data: data.data ? data.data : "0x",
      callType: data.callType ? data.callType : CallType.CALL,
      replayProtection,
      replayProtectionAuthority: this.replayProtectionAuthority.getAddress(),
      chainId: this.chainID,
      signature,
    };
  }

  /**
   * Builds the proxy contract address.
   * @param creatorAddress Creator of the clone contract (ProxyAccountDeployer)
   * @param signersAddress Signer's address
   * @param cloneAddress Contract to clone address
   */
  public static buildProxyAccountAddress(signersAddress: string): string {
    const saltHex = solidityKeccak256(["address"], [signersAddress]);
    const byteCodeHash = solidityKeccak256(
      ["bytes", "bytes20", "bytes"],
      [
        "0x3d602d80600a3d3981f3363d3d373d3d3d363d73",
        BASE_ACCOUNT_ADDRESS,
        "0x5af43d82803e903d91602b57fd5bf3",
      ]
    );
    const options: Create2Options = {
      from: PROXY_ACCOUNT_DEPLOYER_ADDRESS,
      salt: saltHex,
      initCodeHash: byteCodeHash,
    };

    return getCreate2Address(options);
  }
}
