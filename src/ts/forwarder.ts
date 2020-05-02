import { ChainID } from "..";
import { ReplayProtectionAuthority } from "./replayprotectionauthority";
import { Contract, Wallet } from "ethers";
import { defaultAbiCoder, BigNumberish } from "ethers/utils";

export interface ForwardParams {
  to: string;
  signer: string;
  target: string;
  value: string;
  data: string;
  replayProtection: string;
  replayProtectionAuthority: string;
  chainId: number;
  signature: string;
}

export interface DeploymentParams {
  to: string;
  signer: string;
  data: string;
  replayProtection: string;
  replayProtectionAuthority: string;
  chainId: number;
  signature: string;
}

export interface RelayCallData {
  target: string;
  callData: string;
}

export interface ProxyCallData {
  target: string;
  value: BigNumberish;
  callData: string;
}

export abstract class Forwarder<T> {
  constructor(
    protected readonly chainID: ChainID,
    protected readonly forwarder: Contract,
    protected readonly replayProtectionAuthority: ReplayProtectionAuthority
  ) {}

  protected abstract getEncodedCallData(data: T): string;
  /**
   * A meta-transaction includes:
   * - Calldata
   * - Replay protection (and authority)
   * - Verifier contract address
   *
   * We compute and return the encoded meta-transaction to be signed.
   * @param encodedCallData Encoding includes target, value and calldata
   * @param encodedReplayProtection Encoding includes the replay protection nonces (e.g. typically 2 nonces)
   * @param replayProtectionAuthority Address of replay protection
   * @param contract Contract for verifying the replay protection
   */
  protected encodeMetaTransactionToSign(
    encodedCallData: string,
    encodedReplayProtection: string,
    replayProtectionAuthority: string,
    proxyAddress: string
  ): string {
    // We expect encoded call data to include target contract address, the value, and the callData.
    return defaultAbiCoder.encode(
      ["bytes", "bytes", "address", "address", "uint"],
      [
        encodedCallData,
        encodedReplayProtection,
        replayProtectionAuthority,
        proxyAddress,
        this.chainID,
      ]
    );
  }

  public abstract async signMetaTransaction(
    signer: Wallet,
    data: T
  ): Promise<ForwardParams>;

  public abstract async encodeSignedMetaTransaction(
    params: ForwardParams,
    wallet: Wallet
  ): Promise<string>;

  public abstract async signMetaDeployment(
    signer: Wallet,
    initCode: string
  ): Promise<DeploymentParams>;
}
