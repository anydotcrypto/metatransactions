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
    public readonly signer: Wallet,
    protected readonly replayProtectionAuthority: ReplayProtectionAuthority
  ) {}

  /**
   * Encodes calldata for the meta-transaction signature.
   * @param data Target contract, calldata, and sometimes value
   */
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
   * @param proxyAddress RelayHub or ProxyAccount contract address
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

  /**
   * Sign a meta-transaction and return the forward parameters
   * @param data Data required to sign the meta-transaction
   */
  public abstract async signMetaTransaction(data: T): Promise<ForwardParams>;

  /**
   * Encodes the forward function and its arguments such that
   * included in the data field of an Ethereum Transaction.
   * @param params ForwardParameters
   */
  public abstract async encodeSignedMetaTransaction(
    params: ForwardParams
  ): Promise<string>;

  /**
   * Authorises the deployment of a smart contract with a deterministic address
   * @param initCode Bytecode of contract
   */
  public abstract async signMetaDeployment(
    initCode: string
  ): Promise<DeploymentParams>;

  /**
   * The address that will appear in the msg.sender of target contract
   */
  public abstract async getOnchainAddress(): Promise<string>;
}
