import { defaultAbiCoder, BigNumber } from "ethers/utils";
import { Wallet } from "ethers";
import { ReplayProtectionAuthority } from "./replayprotectionauthority";
import { Lock } from "@pisa-research/utils";

export class MultiNonce extends ReplayProtectionAuthority {
  private index: BigNumber;
  // Weird JS Bug. If BigNumber is the Key, then the lookup
  // will fail. String iS OK.
  private nonceTracker: Map<string, BigNumber>;
  lock: Lock;

  /**
   * MultiNonce replay protection maintains N queues of transactions.
   * Implemented strategy appends every new transaction to the N queues in rotation,
   * so we support up to N out-of-order transactions.
   * @param concurrency Up to N out-of-order transactions at a time
   * @param signer Signer's wallet
   * @param forwarderAddress RelayHub or ProxyAccount
   */
  constructor(
    private readonly concurrency: number,
    signer: Wallet,
    forwarderAddress: string
  ) {
    super(signer, forwarderAddress);
    this.lock = new Lock();
    this.index = new BigNumber(0);
    this.nonceTracker = new Map<string, BigNumber>();
  }

  /**
   * Fetch latest nonce we can use for the replay protection.
   * We assume that a transaction is immediately broadcasted if this function is called.
   */
  private async getLatestMultiNonce() {
    let storedNonce = this.nonceTracker.get(this.index.toString());
    // Have we used this nonce before?
    if (!storedNonce) {
      // No, let's grab it from the contract.
      storedNonce = await this.accessNonceStore(this.index);
    }

    const newIndex = this.index;

    // Store for next time
    this.nonceTracker.set(this.index.toString(), storedNonce.add(1));
    this.index = this.index.add(1).mod(this.concurrency);
    return { newIndex, storedNonce };
  }

  /**
   * Fetch the latest replay protection and encode it.
   */
  public async getEncodedReplayProtection() {
    try {
      await this.lock.acquire();
      const { newIndex, storedNonce } = await this.getLatestMultiNonce();
      return defaultAbiCoder.encode(["uint", "uint"], [newIndex, storedNonce]);
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
