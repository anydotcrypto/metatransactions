import { keccak256, arrayify, defaultAbiCoder, BigNumber } from "ethers/utils";
import { Wallet } from "ethers/wallet";
import { Contract } from "ethers";
import { MultiNonce } from "./multinonce";
import { ReplayProtectionAuthority } from "./replayprotection";

export interface ForwardParams {
  hub: string;
  signer: string;
  target: string;
  value: string;
  data: string;
  replayProtection: string;
  replayProtectionAuthority: string;
  chainId: number;
  signature: string;
}

/**
 * A single library for approving meta-transactions and its associated
 * replay protection.
 */
export class HubReplayProtection {
  /**
   * Multi-nonce replay protection
   * @param hubContract RelayHub or ContractAccount
   * @param concurrency Up to N concurrent transactions at a time
   */
  public static multinonce(hubContract: Contract, concurrency: number) {
    return new HubReplayProtection(
      hubContract,
      new MultiNonce(hubContract, concurrency)
    );
  }

  /**
   * Initialize replay protection with replay-by-nonce
   * @param hubContract RelayHub or ContractAccount
   */
  constructor(
    private readonly hubContract: Contract,
    private readonly replayProtectionAuthority: ReplayProtectionAuthority
  ) {}

  /**
   * Standard encoding for contract call data
   * @param target Target contract
   * @param value Denominated in wei
   * @param callData Encoded function call with data
   */
  public getEncodedCallData(
    target: string,
    value: BigNumber,
    callData: string
  ) {
    return defaultAbiCoder.encode(
      ["address", "uint", "bytes"],
      [target, value, callData]
    );
  }

  /**
   *
   * @param encodedCallData Encoding includes target, value and calldata
   * @param encodedReplayProtection Encoding includes the replay protection nonces (e.g. typically 2 nonces)
   * @param replayProtectionAuthority Address of replay protection
   */
  public encodeMetaTransactionToSign(
    encodedCallData: string,
    encodedReplayProtection: string,
    replayProtectionAuthority: string
  ): string {
    // We expect encoded call data to include target contract address, the value, and the callData.
    // Message signed: H(encodedCallData, encodedReplayProtection, replay protection authority, relay contract address, chainid);
    return defaultAbiCoder.encode(
      ["bytes", "bytes", "address", "address", "uint"],
      [
        encodedCallData,
        encodedReplayProtection,
        replayProtectionAuthority,
        this.hubContract.address,
        0
      ]
    );
  }

  /**
   * Fetch encoded replay protection from the authority
   * @param signer Signer
   */
  public async getEncodedReplayProtection(signer: Wallet) {
    return await this.replayProtectionAuthority.getEncodedReplayProtection(
      signer.address,
      this.hubContract
    );
  }
  /**
   * Easy method for signing a meta-transaction. Takes care of replay protection.
   * Note it is using replace-by-nonce, and not multinonce as the "index" is always 0.
   * @param relayHubAddress Relay or Contract Hub address
   * @param signer Signer's wallet
   * @param target Target contract address
   * @param value Value to send
   * @param msgSenderCall Encoded calldata
   */
  public async signMetaTransaction(
    signer: Wallet,
    target: string,
    value: BigNumber,
    callData: string
  ) {
    // Encode expected data
    const encodedReplayProtection = await this.replayProtectionAuthority.getEncodedReplayProtection(
      signer.address,
      this.hubContract
    );
    const encodedCallData = this.getEncodedCallData(target, value, callData);
    const encodedData = this.encodeMetaTransactionToSign(
      encodedCallData,
      encodedReplayProtection,
      this.replayProtectionAuthority.getAddress()
    );

    const signature = await signer.signMessage(
      arrayify(keccak256(encodedData))
    );
    const params: ForwardParams = {
      hub: this.hubContract.address,
      signer: signer.address,
      target: target,
      value: value.toString(),
      data: callData,
      replayProtection: encodedReplayProtection,
      replayProtectionAuthority: this.replayProtectionAuthority.getAddress(),
      chainId: 0,
      signature: signature
    };

    return params;
  }

  /**
   * Easy method for signing a meta-transaction. Takes care of replay protection.
   * Note it is using replace-by-nonce, and not multinonce as the "index" is always 0.
   * @param relayHubAddress Relay or Contract Hub address
   * @param signer Signer's wallet
   * @param target Target contract address
   * @param value Value to send
   * @param msgSenderCall Encoded calldata
   */
  public async signMetaDeployment(signer: Wallet, initCode: string) {
    // Encode expected data
    const encodedReplayProtection = await this.replayProtectionAuthority.getEncodedReplayProtection(
      signer.address,
      this.hubContract
    );
    const encodedData = this.encodeMetaTransactionToSign(
      initCode,
      encodedReplayProtection,
      this.replayProtectionAuthority.getAddress()
    );

    const signature = await signer.signMessage(
      arrayify(keccak256(encodedData))
    );

    const params: ForwardParams = {
      hub: this.hubContract.address,
      signer: signer.address,
      target: "0x0000000000000000000000000000000000000000",
      value: "0",
      data: initCode,
      replayProtection: encodedReplayProtection,
      replayProtectionAuthority: this.replayProtectionAuthority.getAddress(),
      chainId: 0,
      signature: signature
    };

    return params;
  }
}
