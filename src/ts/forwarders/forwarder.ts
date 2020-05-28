import { ChainID } from "../..";
import { ReplayProtectionAuthority } from "../replayProtection/replayProtectionAuthority";
import { Signer } from "ethers";
import {
  defaultAbiCoder,
  BigNumberish,
  arrayify,
  keccak256,
} from "ethers/utils";

export enum CallType {
  CALL = 0,
  DELEGATE = 1,
  BATCH = 2,
}

export interface MinimalTx {
  to: string;
  data: string;
  value?: BigNumberish;
}

export interface RevertableMinimalTx extends MinimalTx {
  callType?: CallType;
  revertOnFail?: boolean;
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

type RequiredPick<T, TRequired extends keyof T> = T &
  Pick<Required<T>, TRequired>;
export type RequiredTo<T extends { to?: string }> = RequiredPick<T, "to">;

/**
 * Provides common functionality for the RelayHub and the ProxyAccounts.
 * Possible to extend it with additional functionality if another
 * msg.sender solution emerges.
 */
export abstract class Forwarder<TParams> {
  constructor(
    protected readonly chainID: ChainID,
    public readonly signer: Signer,
    /**
     * The address of this forwarder contract
     */
    public readonly address: string,
    protected readonly replayProtectionAuthority: ReplayProtectionAuthority
  ) {}

  /**
   * Encodes calldata for the meta-transaction signature.
   * @param data Target contract, calldata, and sometimes value
   */
  protected abstract getEncodedCallData(data: RequiredTo<TParams>): string;

  /**
   * A meta-transaction includes:
   * - Calldata
   * - Replay protection (and authority)
   * - Forwarder
   *
   * We compute and return the encoded meta-transaction to be signed.
   * @param encodedCallData Encoding includes target, value and calldata
   * @param encodedReplayProtection Encoding includes the replay protection nonces (e.g. typically 2 nonces)
   * @param replayProtectionAuthority Address of replay protection
   * @param proxyAddress RelayHub or ProxyAccount contract address
   */
  protected encodeMetaTransactionToSign(
    encodedCallData: string,
    encodedReplayProtection: string,
    replayProtectionAuthority: string
  ): string {
    // We expect encoded call data to include target contract address, the value, and the callData.
    return defaultAbiCoder.encode(
      ["bytes", "bytes", "address", "address", "uint"],
      [
        encodedCallData,
        encodedReplayProtection,
        replayProtectionAuthority,
        this.address,
        this.chainID,
      ]
    );
  }

  /**
   * Given the calldata, it returns a signed meta-transaction that can be directly included
   * in an Ethereum Transaction.
   * @param tx ProxyAccountCallData or RelayCallData
   */
  public async signAndEncodeMetaTransaction(tx: TParams): Promise<MinimalTx> {
    const forwardParams = await this.signMetaTransaction(
      tx as RequiredTo<TParams>
    );
    return await this.encodeSignedMetaTransaction(forwardParams);
  }

  /**
   * Takes care of replay protection and signs a meta-transaction.
   * @param data ProxyAccountCallData or RelayCallData
   */
  protected async signMetaTransaction(data: RequiredTo<TParams>) {
    const encodedReplayProtection = await this.replayProtectionAuthority.getEncodedReplayProtection();
    const encodedCallData = this.getEncodedCallData(data);
    const encodedMetaTx = this.encodeMetaTransactionToSign(
      encodedCallData,
      encodedReplayProtection,
      this.replayProtectionAuthority.address
    );

    const signature = await this.signer.signMessage(
      arrayify(keccak256(encodedMetaTx))
    );

    const params = await this.getForwardParams(
      this.address,
      data,
      encodedReplayProtection,
      signature
    );

    return params;
  }

  /**
   * Fetches the forward parameters. Used when signing a new
   * meta-transaction.
   * @param to Forwarder address
   * @param data Target, value and calldata
   * @param replayProtection Encoded replay protection
   * @param signature Signature to authorise meta-transaction
   */
  protected abstract async getForwardParams(
    to: string,
    data: RequiredTo<TParams>,
    replayProtection: string,
    signature: string
  ): Promise<ForwardParams>;

  /**
   * Encodes the forward function and its arguments such that
   * included in the data field of an Ethereum Transaction.
   * @param params ForwardParameters
   */
  protected abstract async encodeSignedMetaTransaction(
    params: ForwardParams
  ): Promise<MinimalTx>;
}
