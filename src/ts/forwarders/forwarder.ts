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

  protected abstract encodeBatchCallData(data: TBatchCallData[]): string;
  protected abstract async encodeBatchTx(
    data: TBatchCallData[],
    replayProtection: string,
    replayProtectionAuthority: string,
    signature: string
  ): Promise<string>;
  protected abstract encodeCallData(data: TCallData): string;
  protected abstract async encodeTx(
    data: TCallData,
    replayProtection: string,
    replayProtectionAuthority: string,
    signature: string
  ): Promise<string>;
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

  public async encodeAndSignParams(
    data: TCallData | TBatchCallData[],
    replayProtection: string,
    replayProtectionAuthority: string
  ) {
    let callData;
    if (Array.isArray(data)) {
      callData = this.encodeBatchCallData(data);
    } else {
      callData = this.encodeCallData(data);
    }

    const encodedMetaTx = defaultAbiCoder.encode(
      ["bytes", "bytes", "address", "address", "uint"],
      [
        callData,
        replayProtection,
        replayProtectionAuthority,
        this.address,
        this.chainID,
      ]
    );

    const signature = await this.signer.signMessage(
      arrayify(keccak256(encodedMetaTx))
    );

    let encodedTx;

    if (Array.isArray(data)) {
      encodedTx = await this.encodeBatchTx(
        data,
        replayProtection,
        this.replayProtectionAuthority.address,
        signature
      );
    } else {
      encodedTx = await this.encodeTx(
        data,
        replayProtection,
        this.replayProtectionAuthority.address,
        signature
      );
    }

    return {
      encodedTx,
      signature,
    };
  }

  /**
   * Takes care of replay protection and signs a meta-transaction.
   * @param data ProxyAccountCallData or RelayCallData
   */
  protected async signAndEncodeMetaTransaction(
    data: TCallData
  ): Promise<MinimalTx> {
    const replayProtection = await this.replayProtectionAuthority.getEncodedReplayProtection();

    const { encodedTx } = await this.encodeAndSignParams(
      data,
      replayProtection,
      this.replayProtectionAuthority.address
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
    const replayProtection = await this.replayProtectionAuthority.getEncodedReplayProtection();

    const { encodedTx } = await this.encodeAndSignParams(
      dataList,
      replayProtection,
      this.replayProtectionAuthority.address
    );

    return {
      to: this.address,
      data: encodedTx,
    };
  }
}
