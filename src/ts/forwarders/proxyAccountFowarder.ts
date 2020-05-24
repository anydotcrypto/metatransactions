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
  RequiredTarget,
  CallType,
} from "./forwarder";
import { Create2Options, getCreate2Address } from "ethers/utils/address";
import { abi } from "../../typedContracts/ProxyAccount.json";

import { ProxyAccountDeployerFactory } from "../../typedContracts/ProxyAccountDeployerFactory";
import {
  PROXY_ACCOUNT_DEPLOYER_ADDRESS,
  BASE_ACCOUNT_ADDRESS,
  DELEGATE_DEPLOYER_ADDRESS,
} from "../../deployment/addresses";
import { Signer } from "ethers";

import { DelegateDeployerFactory } from "../../typedContracts/DelegateDeployerFactory";

export interface ProxyAccountCallData {
  target: string;
  value?: BigNumberish;
  data?: string;
  callType?: CallType;
}

export interface RevertableProxyAccountCallData extends ProxyAccountCallData {
  revertOnFail?: boolean;
}

/**
 * A single library for approving meta-transactions and its associated
 * replay protection. All meta-transactions are sent via proxy contracts.
 */
export class ProxyAccountForwarder extends Forwarder<
  Partial<ProxyAccountCallData>
> {
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
   * Computes the deterministic address for a deployed contract
   * @param initData Initialisation code for the contract
   * @param salt One-time use value.
   */
  public buildDeployedContractAddress(
    initData: string,
    extraData: string
  ): string {
    const byteCodeHash = solidityKeccak256(["bytes"], [initData]);
    const saltHash = keccak256(extraData);
    const saltHex = solidityKeccak256(["bytes32"], [saltHash]);

    const options: Create2Options = {
      from: this.address,
      salt: saltHex,
      initCodeHash: byteCodeHash,
    };

    return getCreate2Address(options);
  }
  /**
   * Standard encoding for contract call data
   * @param data The target contract, value (wei) to send, and the calldata to execute in the target contract
   */
  protected getEncodedCallData(data: RequiredTarget<ProxyAccountCallData>) {
    return defaultAbiCoder.encode(
      ["uint", "address", "uint", "bytes"],
      [
        data.callType ? data.callType : CallType.CALL,
        data.target,
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
  ): Promise<MinimalTx> {
    const proxyAccount = new ProxyAccountFactory(this.signer).attach(params.to);
    let callData;

    if (params.callType == CallType.DELEGATE) {
      callData = proxyAccount.interface.functions.delegate.encode([
        { target: params.target, value: params.value, callData: params.data },
        params.replayProtection,
        params.replayProtectionAuthority,
        params.signature,
      ]);
    } else {
      // We assume it is a CALL - safe default.
      callData = proxyAccount.interface.functions.forward.encode([
        { target: params.target, value: params.value, callData: params.data },
        params.replayProtection,
        params.replayProtectionAuthority,
        params.signature,
      ]);
    }

    return { to: params.to, data: callData, value: params.value };
  }

  /**
   * Batches a list of transactions into a single meta-transaction.
   * It supports both meta-transactions & meta-deployment.
   * @param dataList List of meta-transactions to batch
   */
  public async signAndEncodeBatchTransaction(
    dataList: RevertableProxyAccountCallData[]
  ): Promise<MinimalTx> {
    const metaTxList = [];

    for (const data of dataList) {
      metaTxList.push({
        target: data.target,
        value: data.value ? data.value : 0,
        callData: data.data ? data.data : "0x",
        callType: data.callType ? data.callType : CallType.CALL,
        revertOnFail: data.revertOnFail ? data.revertOnFail : false,
      });
    }

    // Prepare the meta-transaction & sign it
    const encodedReplayProtection = await this.replayProtectionAuthority.getEncodedReplayProtection();
    const encodedCallData = defaultAbiCoder.encode(
      [
        "uint",
        "tuple(address target, uint value, bytes callData, bool revertOnFail, uint callType)[]",
      ],
      [CallType.BATCH, metaTxList]
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
      metaTxList,
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
   * @param value Quantity of WEI to send
   * @param extraData Extra data for the salt
   */
  protected async signMetaDeployment(
    initCode: string,
    value: BigNumberish,
    extraData: string
  ): Promise<ForwardParams> {
    const deployer = new DelegateDeployerFactory(this.signer).attach(
      DELEGATE_DEPLOYER_ADDRESS
    );

    const data = deployer.interface.functions.deploy.encode([
      initCode,
      value,
      keccak256(extraData),
    ]);

    const tx = {
      target: DELEGATE_DEPLOYER_ADDRESS,
      data: data,
      callType: CallType.DELEGATE,
    };

    return await this.signMetaTransaction(tx);
  }

  /**
   * Wraps the deployment inside a meta-transaction. It is deployed via a global
   * deployer (we set it as params.target). Returns the encoded function call.
   * @param initCode Initialisation code for the contract
   * @param value Quantity of WEI to send
   * @param extraData Extra data for the salt
   */
  public async signAndEncodeMetaDeployment(
    initCode: string,
    value: BigNumberish,
    extraData: string
  ): Promise<MinimalTx> {
    const deployer = new DelegateDeployerFactory(this.signer).attach(
      DELEGATE_DEPLOYER_ADDRESS
    );

    const data = deployer.interface.functions.deploy.encode([
      initCode,
      value,
      keccak256(extraData),
    ]);

    const tx = {
      target: DELEGATE_DEPLOYER_ADDRESS,
      data: data,
      callType: CallType.DELEGATE,
    };

    const params = await this.signMetaTransaction(tx);
    return await this.encodeSignedMetaTransaction(params);
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
    data: RequiredTarget<ProxyAccountCallData>,
    replayProtection: string,
    signature: string
  ): Promise<ForwardParams> {
    return {
      to,
      signer: await this.signer.getAddress(),
      target: data.target,
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

  /**
   * Checks if the ProxyContract is already deployed.
   * @returns TRUE if deployed, FALSE if not deployed.
   */
  public async isContractDeployed(): Promise<boolean> {
    const code = await this.signer.provider!.getCode(this.address);
    // Geth will return '0x', and ganache-core v2.2.1 will return '0x0'
    const codeIsEmpty = !code || code === "0x" || code === "0x0";
    return !codeIsEmpty;
  }
}
