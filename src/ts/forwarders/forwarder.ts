import { ChainID } from "../..";
import { ReplayProtectionAuthority } from "../replayProtection/replayProtectionAuthority";
import { Signer } from "ethers";
import {
  defaultAbiCoder,
  BigNumberish,
  arrayify,
  keccak256,
} from "ethers/utils";
import { DELEGATE_DEPLOYER_ADDRESS } from "../../deployment/addresses";
import { DelegateDeployerFactory } from "../../typedContracts/DelegateDeployerFactory";

export enum CallType {
  CALL = 0,
  DELEGATE = 1,
  BATCH = 2,
}

export interface MinimalTx {
  to: string;
  data: string;
}

export interface ForwardParams {
  to: string;
  signer: string;
  target: string;
  value: string;
  data: string;
  callType: CallType;
  replayProtection: string;
  replayProtectionAuthority: string;
  chainId: number;
  signature: string;
}

export type DirectCallData = {
  to: string;
  data?: string;
  value?: BigNumberish;
};

export type DeployCallData = {
  data: string;
  value?: BigNumberish;
  salt: string;
};

type CallData = DirectCallData | DeployCallData;

// https://stackoverflow.com/questions/42123407/does-typescript-support-mutually-exclusive-types
type Without<T, U> = { [P in Exclude<keyof T, keyof U>]?: never };
export type XOR<T, U> = T | U extends object
  ? (Without<T, U> & U) | (Without<U, T> & T)
  : T | U;

/**
 * Provides common functionality for the RelayHub and the ProxyAccounts.
 * Possible to extend it with additional functionality if another
 * msg.sender solution emerges.
 */
export abstract class Forwarder<
  TCallData extends DirectCallData,
  TDeployCallData extends DeployCallData,
  TBatchCallData extends CallData,
  TBatchDeployCallData extends CallData
> {
  constructor(
    protected readonly chainID: ChainID,
    public readonly signer: Signer,
    /**
     * The address of this forwarder contract
     */
    public readonly address: string,
    protected readonly replayProtectionAuthority: ReplayProtectionAuthority
  ) {}

  protected abstract deployDataToBatchCallData(
    initCode: string,
    extraData: string,
    value?: BigNumberish,
    revertOnFail?: boolean
  ): TBatchCallData;
  protected abstract deployDataToCallData(
    initCode: string,
    extraData: string,
    value?: BigNumberish
  ): TCallData;

  private isDeployTx(tx: CallData): tx is DeployCallData {
    return !!(tx as DeployCallData).salt;
  }

  /**
   * Sign a meta transaction or a batch of meta transactions.
   * Deployments can als be made by specifiying a salt along with the data.
   * @param tx
   */
  public async signMetaTransaction(
    tx:
      | XOR<TCallData, TDeployCallData>
      | XOR<TBatchCallData, TBatchDeployCallData>[]
  ): Promise<MinimalTx> {
    if (Array.isArray(tx)) {
      const encodedTransactions = tx.map((t) =>
        this.isDeployTx(t)
          ? this.deployDataToBatchCallData(t.data, t.salt, t.value || "0x")
          : (t as TBatchCallData)
      );

      return await this.signAndEncodeBatchMetaTransaction(encodedTransactions);
    } else {
      const txOrDeploy = this.isDeployTx(tx)
        ? this.deployDataToCallData(tx.data, tx.salt, tx.value || "0x")
        : (tx as TCallData);

      return await this.signAndEncodeMetaTransaction(txOrDeploy);
    }
  }

  protected encodeForDeploy(
    initCode: string,
    extraData: string,
    value: BigNumberish
  ) {
    const deployer = new DelegateDeployerFactory(this.signer).attach(
      DELEGATE_DEPLOYER_ADDRESS
    );

    const data = deployer.interface.functions.deploy.encode([
      initCode,
      value,
      keccak256(extraData),
    ]);

    return {
      to: deployer.address,
      data: data,
    };
  }

  /**
   * Takes care of replay protection and signs a meta-transaction.
   * @param data ProxyAccountCallData or RelayCallData
   */
  protected abstract async signAndEncodeMetaTransaction(
    data: TCallData
  ): Promise<MinimalTx>;

  /**
   * Batches a list of transactions into a single meta-transaction.
   * It supports both meta-transactions & meta-deployment.
   * @param dataList List of meta-transactions to batch
   */
  protected abstract async signAndEncodeBatchMetaTransaction(
    dataList: TBatchCallData[]
  ): Promise<MinimalTx>;

  /**
   * Checks if the ProxyContract is already deployed.
   * @returns TRUE if deployed, FALSE if not deployed.
   */
  public async isWalletDeployed(): Promise<boolean> {
    const code = await this.signer.provider!.getCode(this.address);
    // Geth will return '0x', and ganache-core v2.2.1 will return '0x0'
    const codeIsEmpty = !code || code === "0x" || code === "0x0";
    return !codeIsEmpty;
  }
}

/**
 * The mini forwarders are our home grown ones. They're mini because they try to minimise
 * code complexity and gas costs. But are potentially not a feature-rich.
 */
export abstract class MiniForwarder<
  TCallData extends DirectCallData,
  TDeployCallData extends DeployCallData,
  TBatchCallData extends CallData,
  TBatchDeployCallData extends CallData
> extends Forwarder<
  TCallData,
  TDeployCallData,
  TBatchCallData,
  TBatchDeployCallData
> {
  protected abstract encodeBatchCallData(data: TBatchCallData[]): string;
  protected abstract async encodeForBatchForward(
    data: TBatchCallData[],
    replayProtection: string,
    replayProtectionAuthority: string,
    signature: string
  ): Promise<string>;
  protected abstract encodeCallData(data: TCallData): string;
  protected abstract async encodeForForward(
    data: TCallData,
    replayProtection: string,
    replayProtectionAuthority: string,
    signature: string
  ): Promise<string>;
  public abstract decodeTx(
    data: string
  ): {
    _metaTx: Required<TCallData>;
    _replayProtection: string;
    _replayProtectionAuthority: string;
    _signature: string;
  };
  public abstract decodeBatchTx(
    data: string
  ): {
    _metaTxList: Required<TBatchCallData[]>;
    _replayProtection: string;
    _replayProtectionAuthority: string;
    _signature: string;
  };

  /**
   * Takes care of replay protection and signs a meta-transaction.
   * @param data ProxyAccountCallData or RelayCallData
   */
  protected async signAndEncodeMetaTransaction(
    data: TCallData
  ): Promise<MinimalTx> {
    const callData = this.encodeCallData(data);
    const replayProtection = await this.replayProtectionAuthority.getEncodedReplayProtection();

    const encodedMetaTx = defaultAbiCoder.encode(
      ["bytes", "bytes", "address", "address", "uint"],
      [
        callData,
        replayProtection,
        this.replayProtectionAuthority.address,
        this.address,
        this.chainID,
      ]
    );

    const signature = await this.signer.signMessage(
      arrayify(keccak256(encodedMetaTx))
    );

    const encodedTx = await this.encodeForForward(
      data,
      replayProtection,
      this.replayProtectionAuthority.address,
      signature
    );

    return {
      to: this.address,
      data: encodedTx,
    };
  }

  /**
   * Batches a list of transactions into a single meta-transaction.
   * It supports both meta-transactions & meta-deployment.
   * @param dataList List of meta-transactions to batch
   */
  protected async signAndEncodeBatchMetaTransaction(
    dataList: TBatchCallData[]
  ): Promise<MinimalTx> {
    const callData = this.encodeBatchCallData(dataList);
    const replayProtection = await this.replayProtectionAuthority.getEncodedReplayProtection();
    const encodedMetaTx = defaultAbiCoder.encode(
      ["bytes", "bytes", "address", "address", "uint"],
      [
        callData,
        replayProtection,
        this.replayProtectionAuthority.address,
        this.address,
        this.chainID,
      ]
    );

    const signature = await this.signer.signMessage(
      arrayify(keccak256(encodedMetaTx))
    );

    const encodedTx = await this.encodeForBatchForward(
      dataList,
      replayProtection,
      this.replayProtectionAuthority.address,
      signature
    );

    return {
      to: this.address,
      data: encodedTx,
    };
  }
}
