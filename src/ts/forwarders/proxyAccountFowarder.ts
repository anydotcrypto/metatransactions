import {
  defaultAbiCoder,
  solidityKeccak256,
  Interface,
  BigNumberish,
  keccak256,
} from "ethers/utils";
import { ReplayProtectionAuthority } from "../replayProtection/replayProtectionAuthority";
import { ChainID } from "./forwarderFactory";
import {
  ProxyAccountDeployer,
  ProxyAccountFactory,
  ProxyAccount,
} from "../../typedContracts";
import { MinimalTx, CallType, MiniForwarder } from "./forwarder";
import { Create2Options, getCreate2Address } from "ethers/utils/address";
import { abi } from "../../typedContracts/ProxyAccount.json";
import { ProxyAccountDeployerFactory } from "../../typedContracts/ProxyAccountDeployerFactory";
import {
  PROXY_ACCOUNT_DEPLOYER_ADDRESS,
  BASE_ACCOUNT_ADDRESS,
} from "../../deployment/addresses";
import { Signer } from "ethers";
import { WalletForwarder } from "./walletForwarder";

export interface ProxyAccountCallData {
  to: string;
  value?: BigNumberish;
  data?: string;
  callType?: CallType;
}

export interface RevertableProxyAccountCallData extends ProxyAccountCallData {
  revertOnFail?: boolean;
}

export interface ProxyAccountDeployCallData {
  value?: BigNumberish;
  data: string;
  salt: string;
}

export interface RevertableProxyAccountDeployCallData
  extends ProxyAccountDeployCallData {
  revertOnFail?: boolean;
}

/**
 * A single library for approving meta-transactions and its associated
 * replay protection. All meta-transactions are sent via proxy contracts.
 */
export class ProxyAccountForwarder
  extends MiniForwarder<
    ProxyAccountCallData,
    ProxyAccountDeployCallData,
    RevertableProxyAccountCallData,
    RevertableProxyAccountDeployCallData
  >
  implements WalletForwarder {
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

  private defaultCallData(
    data: ProxyAccountCallData
  ): Required<ProxyAccountCallData> {
    return {
      to: data.to,
      value: data.value ? data.value : 0,
      data: data.data ? data.data : "0x",
      callType: data.callType ? data.callType : CallType.CALL,
    };
  }

  private defaultRevertableCallData(
    data: RevertableProxyAccountCallData
  ): Required<RevertableProxyAccountCallData> {
    return {
      ...this.defaultCallData(data),
      revertOnFail: data.revertOnFail ? data.revertOnFail : false,
    };
  }

  protected deployDataToCallData(
    initCode: string,
    extraData: string,
    value: BigNumberish
  ): ProxyAccountCallData {
    return {
      ...this.encodeForDeploy(initCode, extraData, value),
      value: "0",
      callType: CallType.DELEGATE,
    };
  }

  protected deployDataToBatchCallData(
    initCode: string,
    extraData: string,
    value: BigNumberish,
    revertOnFail?: boolean
  ): RevertableProxyAccountCallData {
    return {
      ...this.encodeForDeploy(initCode, extraData, value),
      value: "0",
      callType: CallType.DELEGATE,
      revertOnFail: revertOnFail || false,
    };
  }

  public decodeTx(data: string) {
    const proxyAccount = new ProxyAccountFactory(this.signer).attach(
      this.address
    );
    const parsedTransaction = proxyAccount.interface.parseTransaction({
      data,
    });
    const functionArgs: {
      _metaTx: Required<ProxyAccountCallData>;
      _replayProtection: string;
      _replayProtectionAuthority: string;
      _signature: string;
    } = {
      _metaTx: {
        to: parsedTransaction.args[0][0],
        value: parsedTransaction.args[0][1],
        data: parsedTransaction.args[0][2],
        callType: parsedTransaction.args[0][3],
      },
      _replayProtection: parsedTransaction.args[1],
      _replayProtectionAuthority: parsedTransaction.args[2],
      _signature: parsedTransaction.args[3],
    };
    return functionArgs;
  }

  public decodeBatchTx(data: string) {
    const proxyAccount = new ProxyAccountFactory(this.signer).attach(
      this.address
    );
    const parsedTransaction = proxyAccount.interface.parseTransaction({
      data,
    });

    const functionArgs: {
      _metaTxList: Required<RevertableProxyAccountCallData>[];
      _replayProtection: string;
      _replayProtectionAuthority: string;
      _signature: string;
    } = {
      _metaTxList: parsedTransaction.args[0].map((a: any) => ({
        to: a[0],
        value: a[1],
        data: a[2],
        revertOnFail: a[3],
        callType: a[4],
      })),
      _replayProtection: parsedTransaction.args[1],
      _replayProtectionAuthority: parsedTransaction.args[2],
      _signature: parsedTransaction.args[3],
    };
    return functionArgs;
  }

  protected encodeCallData(data: ProxyAccountCallData): string {
    const defaulted = this.defaultCallData(data);

    return defaultAbiCoder.encode(
      ["uint", "address", "uint", "bytes"],
      [defaulted.callType, defaulted.to, defaulted.value, defaulted.data]
    );
  }

  protected async encodeForForward(
    data: ProxyAccountCallData,
    replayProtection: string,
    replayProtectionAuthority: string,
    signature: string
  ): Promise<string> {
    const proxyAccount = new ProxyAccountFactory(this.signer).attach(
      this.address
    );
    const txData = proxyAccount.interface.functions.forward.encode([
      this.defaultCallData(data),
      replayProtection,
      replayProtectionAuthority,
      signature,
    ]);
    return txData;
  }

  protected encodeBatchCallData(
    txBatch: RevertableProxyAccountCallData[]
  ): string {
    const metaTxList = txBatch.map((b) => this.defaultRevertableCallData(b));
    return defaultAbiCoder.encode(
      [
        "uint",
        "tuple(address to, uint value, bytes data, bool revertOnFail, uint callType)[]",
      ],
      [CallType.BATCH, metaTxList]
    );
  }

  protected async encodeForBatchForward(
    txBatch: RevertableProxyAccountCallData[],
    replayProtection: string,
    replayProtectionAuthority: string,
    signature: string
  ): Promise<string> {
    const metaTxList = txBatch.map((b) => this.defaultRevertableCallData(b));

    const proxyAccountInterface = new Interface(
      abi
    ) as ProxyAccount["interface"];

    return proxyAccountInterface.functions.batch.encode([
      metaTxList,
      replayProtection,
      replayProtectionAuthority,
      signature,
    ]);
  }

  /**
   * Builds the proxy contract address.
   * @param creatorAddress Creator of the clone contract (ProxyAccountDeployer)
   * @param signersAddress Signer's address
   * @param cloneAddress Contract to clone address
   */
  public static getAddress(signersAddress: string): string {
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
   * Computes the deterministic address for a contract that was
   * deployed by this forwarder
   * @param initData Initialisation code for the contract
   * @param extraData One-time use value.
   */
  public computeAddressForDeployedContract(
    initData: string,
    extraData: string
  ): string {
    const byteCodeHash = solidityKeccak256(["bytes"], [initData]);
    const salt = keccak256(extraData);

    const options: Create2Options = {
      from: this.address,
      salt: salt,
      initCodeHash: byteCodeHash,
    };

    return getCreate2Address(options);
  }
}
