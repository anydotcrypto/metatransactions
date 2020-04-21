import { defaultAbiCoder, BigNumber, keccak256 } from "ethers/utils";
import { Contract } from "ethers";
import { ReplayProtectionAuthority } from "./replayprotection";
import { Lock } from "@pisa-research/utils";

export class MultiNonce extends ReplayProtectionAuthority {
  indexTracker: Map<string, BigNumber>;
  nonceTracker: Map<string, BigNumber>;
  lock: Lock;

  constructor(
    private readonly hubContract: Contract,
    private readonly concurrency: number
  ) {
    super();
    this.indexTracker = new Map<string, BigNumber>();
    this.nonceTracker = new Map<string, BigNumber>();
    this.lock = new Lock();
  }

  /**
   * Fetch latest nonce we can use for the replay protection. It is either taken
   * from the contract directoy or what we have kept in memory.
   * We assume that a transaction is immediately broadcasted if this function is called.
   * @param signer Signer's address
   * @param contractAddress Relay contract's address
   * @param index Concurrency index for reply protection
   */
  private async getLatestMultiNonce(signerAddress: string) {
    // By default, we cycle through each queue.
    // So we maximise concurrency, not ordered transactions.
    let index = this.indexTracker.get(signerAddress);
    if (!index) {
      index = new BigNumber("0");
    }

    // Given the signer's address and queue index, what was the last used nonce in the queue?
    let nonceIndex = keccak256(
      defaultAbiCoder.encode(["string", "uint"], [signerAddress, index])
    );

    let nonce = this.nonceTracker.get(nonceIndex);

    // Have we used this nonce before?
    if (!nonce) {
      // No, let's grab it from the contract.
      nonce = await this.accessNonceStore(
        signerAddress,
        index!,
        this.hubContract
      );
    }

    this.nonceTracker.set(nonceIndex, nonce.add(1)); // Increment for use next time
    this.indexTracker.set(signerAddress, index.add(1).mod(this.concurrency)); // Increment for next time
    return { index, nonce };
  }

  /**
   * Fetches and encodes the latest nonce for this signer
   * Note: If the contract address changes, we will refresh the nonce tracker
   * and freshly request new nonces from the network.
   * @param signerAddress Signer's address
   * @param hubContract RelayHub or ContractAccount
   */
  public async getEncodedReplayProtection(signerAddress: string) {
    try {
      await this.lock.acquire();
      const { index, nonce } = await this.getLatestMultiNonce(signerAddress);
      return defaultAbiCoder.encode(["uint", "uint"], [index, nonce]);
    } finally {
      this.lock.release();
    }
  }

  /**
   * Return address of replay protection authority
   */
  public getAddress() {
    return "0x0000000000000000000000000000000000000000";
  }
}
