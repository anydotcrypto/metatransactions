import { ChainID } from "../..";
import { ReplayProtectionAuthority } from "../replayprotection/replayprotectionauthority";
import { Contract, Wallet } from "ethers";
import {
  defaultAbiCoder,
  BigNumberish,
  arrayify,
  keccak256,
} from "ethers/utils";

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
  initCode: string;
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

/**
 * Provides common functionality for the RelayHub and the ProxyAccounts.
 * Possible to extend it with additional functionality if another
 * msg.sender solution emerges.
 */
export abstract class Forwarder<T> {
  constructor(
    protected readonly chainID: ChainID,
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
   * Takes care of replay protection and signs a meta-transaction.
   * @param data Target contract address, value (wei) to send, and the calldata to exeucte in the target contract
   */
  public async signMetaTransaction(data: T) {
    const forwarderAddr = await this.getAddress();

    const encodedReplayProtection = await this.replayProtectionAuthority.getEncodedReplayProtection();
    const encodedCallData = this.getEncodedCallData(data);
    const encodedMetaTx = this.encodeMetaTransactionToSign(
      encodedCallData,
      encodedReplayProtection,
      this.replayProtectionAuthority.getAddress(),
      forwarderAddr
    );

    const signature = await this.signer.signMessage(
      arrayify(keccak256(encodedMetaTx))
    );

    const params = this.getForwardParams(
      forwarderAddr,
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
  protected abstract getForwardParams(
    to: string,
    data: T,
    replayProtection: string,
    signature: string
  ): ForwardParams;

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
  /**
   * Signs a meta-transaction to deploy a contract via CREATE2.
   * Takes care of replay protection.
   * @param initCode Bytecode for the smart contract
   */
  public async signMetaDeployment(initCode: string) {
    const forwarderAddr = await this.getAddress();

    const encodedReplayProtection = await this.replayProtectionAuthority.getEncodedReplayProtection();
    const encodedMetaTx = this.encodeMetaTransactionToSign(
      initCode,
      encodedReplayProtection,
      this.replayProtectionAuthority.getAddress(),
      forwarderAddr
    );
    const signature = await this.signer.signMessage(
      arrayify(keccak256(encodedMetaTx))
    );

    const params: DeploymentParams = {
      to: forwarderAddr,
      signer: this.signer.address,
      initCode,
      replayProtection: encodedReplayProtection,
      replayProtectionAuthority: this.replayProtectionAuthority.getAddress(),
      chainId: this.chainID,
      signature: signature,
    };

    return params;
  }

  public abstract async encodeSignedMetaDeployment(
    params: DeploymentParams
  ): Promise<string>;

  /**
   * The address that will appear in the msg.sender of target contract
   */
  public abstract async getAddress(): Promise<string>;
}
