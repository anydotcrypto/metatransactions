import { keccak256, defaultAbiCoder, BigNumber } from "ethers/utils";
import { Contract } from "ethers";
import { Nonces, ReplayProtectionAuthority } from "./replayprotection";

export class MultiNonce extends ReplayProtectionAuthority {
  nonceTracker: Map<string, BigNumber>;
  lastUsedIndex: number;
  lastHubAddress: string;

  constructor(private readonly concurrency: number) {
    super();
  }

  /**
   * Fetch latest nonce we can use for the replay protection. It is either taken
   * from the contract directoy or what we have kept in memory.
   * We assume that a transaction is immediately broadcasted if this function is called.
   * @param signer Signer's address
   * @param contractAddress Relay contract's address
   * @param index Concurrency index for reply protection
   */
  private async getLatestMultiNonce(
    signerAddress: string,
    hubContract: Contract
  ): Promise<Nonces> {
    const index = (this.lastUsedIndex + 1) % this.concurrency;

    // By default, we cycle through each queue.
    // So we maximise concurrency, not ordered transactions.
    // Easy way to achieve order is simply to set concurrency == 1.
    this.lastUsedIndex = index;
    this.lastUsedIndex = (this.lastUsedIndex + 1) % this.concurrency;

    const id = keccak256(
      defaultAbiCoder.encode(["address", "uint"], [signerAddress, index])
    );

    const tracked = this.nonceTracker.get(id);

    // Fetch latest number found.
    if (tracked) {
      // Increment it in our store, so we know to serve it.
      this.nonceTracker.set(id, tracked.add(1));
      return { index, latestNonce: tracked };
    } else {
      // In the ReplayProtection.sol, we use latestNonce == storedNonce then continue.
      const latestNonce: BigNumber = await hubContract.nonceStore(id);

      // Increment it our store, so we know to serve it.
      this.nonceTracker.set(id, latestNonce.add(1));
      return { index, latestNonce };
    }
  }

  /**
   * Fetches and encodes the latest nonce for this signer
   * Note: If the contract address changes, we will refresh the nonce tracker
   * and freshly request new nonces from the network.
   * @param signerAddress Signer's address
   * @param hubContract RelayHub or ContractAccount
   */
  public async getEncodedReplayProtection(
    signerAddress: string,
    hubContract: Contract
  ) {
    // Do we need to reset mapping?
    if (this.lastHubAddress != hubContract.address) {
      this.nonceTracker = new Map<string, BigNumber>();
      this.lastUsedIndex = 0;
    }
    const nonces: Nonces = await this.getLatestMultiNonce(
      signerAddress,
      hubContract
    );
    return defaultAbiCoder.encode(
      ["uint", "uint"],
      [nonces.index, nonces.latestNonce]
    );
  }

  /**
   * Return address of replay protection authority
   */
  public getAddress() {
    return "0x0000000000000000000000000000000000000000";
  }
}
