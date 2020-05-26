import { defaultAbiCoder, keccak256, arrayify } from "ethers/utils";
import { ReplayProtectionAuthority } from "../replayProtection/replayProtectionAuthority";
import { RelayHub, ChainID, RelayHubFactory } from "../..";
import {
  ForwardParams,
  Forwarder,
  RequiredTarget,
  CallType,
  MinimalTx,
} from "./forwarder";
import { Signer } from "ethers";

export interface RelayHubCallData {
  target: string;
  data: string;
}

export interface RevertableRelayHubCallData extends RelayHubCallData {
  revertOnFail: boolean;
}

/**
 * A single library for approving meta-transactions and its associated
 * replay protection. All contracts must support the msgSender() standard.
 */
export class RelayHubForwarder extends Forwarder<RelayHubCallData> {
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

  /**
   * Standard encoding for contract call data
   * @param data Target contract and the desired calldata
   */
  protected getEncodedCallData(data: RequiredTarget<RelayHubCallData>) {
    return defaultAbiCoder.encode(
      ["uint", "address", "bytes"],
      [CallType.CALL, data.target, data.data]
    );
  }

  /**
   * Fetch forward parameters
   * @param to RelayHub contract
   * @param data Target contract, value and calldata
   * @param replayProtection Encoded Replay Protection
   * @param replayProtectionAuthority Replay Protection Authority
   * @param signature Signature
   */
  protected async getForwardParams(
    to: string,
    data: RequiredTarget<RelayHubCallData>,
    replayProtection: string,
    signature: string
  ): Promise<ForwardParams> {
    return {
      to,
      signer: await this.signer.getAddress(),
      target: data.target,
      value: "0",
      data: data.data,
      callType: CallType.CALL,
      replayProtection,
      replayProtectionAuthority: this.replayProtectionAuthority.getAddress(),
      chainId: this.chainID,
      signature,
    };
  }

  /**
   *
   * @param dataList List of meta-transactions
   */
  public async signAndEncodeBatchTransaction(
    dataList: RevertableRelayHubCallData[]
  ): Promise<MinimalTx> {
    const metaTxList = [];

    for (const data of dataList) {
      metaTxList.push({
        target: data.target,
        data: data.data,
        revertOnFail: data.revertOnFail ? data.revertOnFail : false,
      });
    }

    // Prepare the meta-transaction & sign it
    const encodedReplayProtection = await this.replayProtectionAuthority.getEncodedReplayProtection();
    const encodedCallData = defaultAbiCoder.encode(
      ["uint", "tuple(address target, bytes data, bool revertOnFail)[]"],
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

    const encodedBatch = this.relayHub.interface.functions.batch.encode([
      metaTxList,
      encodedReplayProtection,
      this.replayProtectionAuthority.getAddress(),
      await this.signer.getAddress(),
      signature,
    ]);

    return { to: this.address, data: encodedBatch };
  }

  /**
   * Encodes the meta-transaction such that it can be included
   * in the data field of an Ethereum Transaction
   * @param params Forward Parameters
   */
  public async encodeSignedMetaTransaction(
    params: ForwardParams
  ): Promise<MinimalTx> {
    return {
      to: params.to,
      data: this.relayHub.interface.functions.forward.encode([
        { target: params.target, data: params.data },
        params.replayProtection,
        params.replayProtectionAuthority,
        params.signer,
        params.signature,
      ]),
    };
  }

  /**
   * Helper function when signing a new meta-transaction
   */
  public async getAddress(): Promise<string> {
    return this.relayHub.address;
  }
}
