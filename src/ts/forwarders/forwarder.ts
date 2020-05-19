import { ChainID } from "../..";
import { ReplayProtectionAuthority } from "../replayProtection/replayProtectionAuthority";
import { Signer } from "ethers";
import {
  defaultAbiCoder,
  BigNumberish,
  arrayify,
  keccak256,
  solidityKeccak256,
  getCreate2Address,
} from "ethers/utils";
import { Create2Options } from "ethers/utils/address";

export interface MinimalTx {
  to: string;
  data: string;
}

export interface RevertableMinimalTx extends MinimalTx {
  revertOnFail: boolean;
}

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

export interface RelayHubCallData {
  to?: string;
  data: string;
}

export interface ProxyAccountCallData {
  to?: string;
  value?: BigNumberish;
  data?: string;
}

type RequiredPick<T, TRequired extends keyof T> = T &
  Pick<Required<T>, TRequired>;
export type RequiredTo<T extends { to?: string }> = RequiredPick<T, "to">;

/**
 * Provides common functionality for the RelayHub and the ProxyAccounts.
 * Possible to extend it with additional functionality if another
 * msg.sender solution emerges.
 */
export abstract class Forwarder<TParams extends Partial<MinimalTx>> {
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
   * Given the calldata, it returns a signed meta-transaction that can be directly included
   * in an Ethereum Transaction.
   * @param tx ProxyAccountCallData or RelayCallData
   */
  public async signAndEncodeMetaTransaction(tx: TParams): Promise<MinimalTx> {
    if (tx.to) {
      // we can cast here since we know to is defined
      const forwardParams = await this.signMetaTransaction(
        tx as RequiredTo<TParams>
      );
      const encodedData = await this.encodeSignedMetaTransaction(forwardParams);
      return { to: forwardParams.to, data: encodedData };
    } else if (tx.data) {
      const deploymentParams = await this.signMetaDeployment(tx.data);
      const encodedData = await this.encodeSignedMetaDeployment(
        deploymentParams
      );
      return { to: deploymentParams.to, data: encodedData };
    } else throw new Error("Either 'to' or 'data' must be supplied.");
  }

  /**
   * Takes care of replay protection and signs a meta-transaction.
   * @param data ProxyAccountCallData or RelayCallData
   */
  public async signMetaTransaction(data: RequiredTo<TParams>) {
    const encodedReplayProtection = await this.replayProtectionAuthority.getEncodedReplayProtection();
    const encodedCallData = this.getEncodedCallData(data);
    const encodedMetaTx = this.encodeMetaTransactionToSign(
      encodedCallData,
      encodedReplayProtection,
      this.replayProtectionAuthority.getAddress(),
      this.address
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
  public abstract async encodeSignedMetaTransaction(
    params: ForwardParams
  ): Promise<string>;

  /**
   * Signs a meta-transaction to deploy a contract via CREATE2.
   * Takes care of replay protection.
   * @param initCode Bytecode for the smart contract
   */
  public async signMetaDeployment(initCode: string) {
    const encodedReplayProtection = await this.replayProtectionAuthority.getEncodedReplayProtection();
    const encodedMetaTx = this.encodeMetaTransactionToSign(
      initCode,
      encodedReplayProtection,
      this.replayProtectionAuthority.getAddress(),
      this.address
    );

    const signature = await this.signer.signMessage(
      arrayify(keccak256(encodedMetaTx))
    );

    const params: DeploymentParams = {
      to: this.address,
      signer: await this.signer.getAddress(),
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
   * Computes the deterministic address for a deployed contract
   * @param params Meta-deployment parameters
   */
  public buildDeployedContractAddress(params: DeploymentParams): string {
    const byteCodeHash = solidityKeccak256(["bytes"], [params.initCode]);
    const saltHex = keccak256(
      defaultAbiCoder.encode(
        ["address", "bytes"],
        [params.signer, params.replayProtection]
      )
    );

    const options: Create2Options = {
      from: params.to,
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
