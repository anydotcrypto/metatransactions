import { defaultAbiCoder, BigNumber } from "ethers/utils";
import { Contract } from "ethers";
import { Nonces, ReplayProtectionAuthority } from "./replayprotection";

export class MultiNonce extends ReplayProtectionAuthority {
  indexTracker: Map<string, BigNumber>;
  nonceTracker: Map<string, BigNumber>;
  lastHubAddress: string;

  constructor(private readonly concurrency: number) {
    super();
    this.indexTracker = new Map<string, BigNumber>();
    this.nonceTracker = new Map<string, BigNumber>();
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
    // By default, we cycle through each queue.
    // So we maximise concurrency, not ordered transactions.
    // Easy way to achieve order is simply to set concurrency == 1.
    // Confirm it is defined
    if (this.indexTracker.has(signerAddress)) {
      const incremented = this.indexTracker
        .get(signerAddress)!
        .add(1)
        .mod(this.concurrency);
      this.indexTracker.set(signerAddress, incremented);
    } else {
      this.indexTracker.set(signerAddress, new BigNumber("0"));
    }

    // Fetch the queue index and the latest position used in the queue.
    const index = this.indexTracker.get(signerAddress)!;

    // Fetch latest number found.
    if (this.nonceTracker.has(signerAddress)) {
      // Increment it in our store, so we know to serve it.
      const tracked = this.nonceTracker.get(signerAddress)!;

      this.nonceTracker.set(signerAddress, tracked.add(1));
      return { index, latestNonce: tracked };
    } else {
      // Fetch nonce from the contract
      // Under the hood, it'll perform a call to the contract.
      const latestNonce: BigNumber = await this.accessHubNonceStore(
        signerAddress,
        index,
        hubContract
      );

      // Increment it our store, so we know to serve it.
      this.nonceTracker.set(signerAddress, latestNonce.add(1));
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
