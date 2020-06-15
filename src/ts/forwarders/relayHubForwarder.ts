import { defaultAbiCoder } from "ethers/utils";
import { ReplayProtectionAuthority } from "../replayProtection/replayProtectionAuthority";
import { RelayHub, ChainID, RelayHubFactory } from "../..";
import { Forwarder, CallType } from "./forwarder";
import { Signer } from "ethers";
import { BigNumberish } from "ethers/utils";

export interface RelayHubCallData {
  to: string;
  data: string;
}

export interface RevertableRelayHubCallData extends RelayHubCallData {
  revertOnFail?: boolean;
}

export interface RelayHubDeployCallData {
  data: string;
  salt: string;
}

export interface RevertableRelayHubDeployCallData
  extends RelayHubDeployCallData {
  revertOnFail?: boolean;
}

/**
 * A single library for approving meta-transactions and its associated
 * replay protection. All contracts must support the msgSender() standard.
 */
export class RelayHubForwarder extends Forwarder<
  RelayHubCallData,
  RelayHubDeployCallData,
  RevertableRelayHubCallData,
  RevertableRelayHubDeployCallData
> {
  private relayHub: RelayHub;
  /**
   * Sets up the RelayHub Forwarder that relies on the msgSender() standard.
   * It can only be used for a single wallet.
   * @param chainID MAINNET or ROPSTE
   * @param signer Signer's wallet
   * @param relayHubAddress RelayHub address
   * @param replayProtectionAuthority Extends implementation ReplayProtectionAuthority
   */
  constructor(
    chainID: ChainID,
    signer: Signer,
    relayHubAddress: string,
    replayProtectionAuthority: ReplayProtectionAuthority
  ) {
    super(chainID, signer, relayHubAddress, replayProtectionAuthority);
    this.relayHub = new RelayHubFactory(signer).attach(relayHubAddress);
  }

  public decodeTx(data: string) {
    const parsedTransaction = this.relayHub.interface.parseTransaction({
      data,
    });
    const functionArgs: {
      _metaTx: Required<RelayHubCallData>;
      _replayProtection: string;
      _replayProtectionAuthority: string;
      _signature: string;
    } = {
      _metaTx: {
        to: parsedTransaction.args[0][0],
        data: parsedTransaction.args[0][1],
      },
      _replayProtection: parsedTransaction.args[1],
      _replayProtectionAuthority: parsedTransaction.args[2],
      _signature: parsedTransaction.args[3],
    };
    return functionArgs;
  }

  public decodeBatchTx(data: string) {
    const parsedTransaction = this.relayHub.interface.parseTransaction({
      data,
    });

    const functionArgs: {
      _metaTxList: Required<RevertableRelayHubCallData>[];
      _replayProtection: string;
      _replayProtectionAuthority: string;
      _signature: string;
    } = {
      _metaTxList: parsedTransaction.args[0].map((a: any) => ({
        to: a[0],
        data: a[1],
        revertOnFail: a[2],
      })),
      _replayProtection: parsedTransaction.args[1],
      _replayProtectionAuthority: parsedTransaction.args[2],
      _signature: parsedTransaction.args[3],
    };

    return functionArgs;
  }

  protected async encodeTx(
    data: RelayHubCallData,
    replayProtection: string,
    replayProtectionAuthority: string,
    signature: string
  ) {
    return this.relayHub.interface.functions.forward.encode([
      this.callDataWithDefaults(data),
      replayProtection,
      replayProtectionAuthority,
      signature,
    ]);
  }

  protected encodeCallData(data: RelayHubCallData): string {
    const defaulted = this.callDataWithDefaults(data);

    return defaultAbiCoder.encode(
      ["uint", "address", "bytes"],
      [CallType.CALL, defaulted.to, defaulted.data]
    );
  }

  private callDataWithDefaults(data: RelayHubCallData): Required<RelayHubCallData> {
    return {
      to: data.to,
      data: data.data ? data.data : "0x",
    };
  }

  private revertableCallDataWithDefaults(
    data: RevertableRelayHubCallData
  ): Required<RevertableRelayHubCallData> {
    return {
      ...this.callDataWithDefaults(data),
      revertOnFail: data.revertOnFail ? data.revertOnFail : false,
    };
  }

  protected encodeBatchCallData(batchTx: RevertableRelayHubCallData[]): string {
    const metaTxList = batchTx.map(b => this.revertableCallDataWithDefaults(b));
    return defaultAbiCoder.encode(
      ["uint", "tuple(address to, bytes data, bool revertOnFail)[]"],
      [CallType.BATCH, metaTxList]
    );
  }

  protected async encodeBatchTx(
    batchTx: RevertableRelayHubCallData[],
    replayProtection: string,
    replayProtectionAuthority: string,
    signature: string
  ) {
    const metaTxList = batchTx.map(b => this.revertableCallDataWithDefaults(b));

    return this.relayHub.interface.functions.batch.encode([
      metaTxList,
      replayProtection,
      replayProtectionAuthority,
      signature,
    ]);
  }

  protected deployDataToBatchCallData(
    initCode: string,
    extraData: string,
    value?: BigNumberish,
    revertOnFail?: boolean
  ): RevertableRelayHubCallData {
    return {
      ...this.encodeForDeploy(initCode, extraData, "0x"),
      revertOnFail: revertOnFail || false,
    };
  }

  protected deployDataToCallData(initCode: string, extraData: string): RelayHubCallData {
    return this.encodeForDeploy(initCode, extraData, "0x");
  }

  /**
   * Helper function when signing a new meta-transaction
   */
  public async getAddress(): Promise<string> {
    return this.relayHub.address;
  }
}
