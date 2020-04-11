import { keccak256, arrayify, defaultAbiCoder, BigNumber } from "ethers/utils";
import { Wallet } from "ethers/wallet";
import { Contract } from "ethers";

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

export class HubReplayProtection {
  nonceTracker = new Map<string, BigNumber>();
  hubContract: Contract; // Default value for mainnet

  constructor(hubContract: Contract) {
    this.hubContract = hubContract;
  }

  /**
   * Fetch latest nonce we can use for the replay protection. It is either taken
   * from the contract directoy or what we have kept in memory.
   * We assume that a transaction WILL be broadcast if this function is called.
   * @param signer Signer's address
   * @param contractAddress Relay contract's address
   * @param index Concurrency index for reply protection
   */
  public async getLatestMultiNonce(
    signerAddress: string,
    hubContract: Contract,
    index: BigNumber
  ) {
    const id = keccak256(
      defaultAbiCoder.encode(["address", "uint"], [signerAddress, index])
    );

    const tracked = this.nonceTracker.get(id);

    // Fetch latest number found.
    if (tracked) {
      // Increment it in our store, so we know to serve it.
      this.nonceTracker.set(id, tracked.add(1));
      return tracked;
    }

    // In the ReplayProtection.sol, we use latestNonce == storedNonce then continue.
    let latestNonce: BigNumber = await hubContract.nonceStore(id);

    // Increment it our store, so we know to serve it.
    this.nonceTracker.set(id, latestNonce.add(1));
    return latestNonce;
  }

  public async getEncodedMultiNonce(
    signerAddress: string,
    hubContract: Contract,
    index: BigNumber
  ) {
    const latestNonce = await this.getLatestMultiNonce(
      signerAddress,
      hubContract,
      index
    );
    return defaultAbiCoder.encode(["uint", "uint"], [index, latestNonce]);
  }

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

  public getEncodedMetaTransactionToSign(
    encodedCallData: string,
    encodedReplayProtection: string,
    replayProtectionAuthority: string,
    hubContract: string
  ) {
    // We expect encoded call data to include target contract address, the value, and the callData.
    // Message signed: H(encodedCallData, encodedReplayProtection, replay protection authority, relay contract address, chainid);
    return defaultAbiCoder.encode(
      ["bytes", "bytes", "address", "address", "uint"],
      [
        encodedCallData,
        encodedReplayProtection,
        replayProtectionAuthority,
        hubContract,
        0
      ]
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
    const encodedReplayProtection = await this.getEncodedMultiNonce(
      signer.address,
      this.hubContract,
      new BigNumber("0")
    );
    const encodedCallData = this.getEncodedCallData(target, value, callData);
    const encodedData = this.getEncodedMetaTransactionToSign(
      encodedCallData,
      encodedReplayProtection,
      "0x0000000000000000000000000000000000000000",
      this.hubContract.address
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
      replayProtectionAuthority: "0x0000000000000000000000000000000000000000",
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
    const encodedReplayProtection = await this.getEncodedMultiNonce(
      signer.address,
      this.hubContract,
      new BigNumber("0")
    );
    const encodedData = this.getEncodedMetaTransactionToSign(
      initCode,
      encodedReplayProtection,
      "0x0000000000000000000000000000000000000000",
      this.hubContract.address
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
      replayProtectionAuthority: "0x0000000000000000000000000000000000000000",
      chainId: 0,
      signature: signature
    };

    return params;
  }
}
