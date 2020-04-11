import { defaultAbiCoder, BigNumber } from "ethers/utils";
import { Contract } from "ethers";
import { Nonces, ReplayProtectionAuthority } from "./replayprotection";
import { wait } from "@pisa-research/test-utils";

export class BitFlip extends ReplayProtectionAuthority {
  indexTracker: Map<string, BigNumber>; // Keep track of bitmap index
  bitmapTracker: Map<string, BigNumber>; // Keep track of bitmap
  lastHubAddress: string;

  constructor() {
    super();
    this.indexTracker = new Map<string, BigNumber>();
    this.bitmapTracker = new Map<string, BigNumber>();
  }

  /**
   * Search through all bitmaps stored in the contract until we find an empty bit.
   * @param signerAddress Signer's address
   * @param hubContract RelayHub or ContractAccount
   * @param searchFrom Starting bitmap index
   */
  private async searchBitmaps(signerAddress: string, hubContract: Contract) {
    let foundEmptyBit = false;
    let bitToFlip = new BigNumber("0");

    // Get the first index
    let searchFrom = this.indexTracker.get(signerAddress);
    if (!searchFrom) {
      searchFrom = new BigNumber("0");
    }

    // Search through bitmaps stored on-chain
    // To find one with an empty bit.
    // This might take awhile for popular wallets.
    // Weneed to consider an API that lets the developer
    // pre-set the "searchFrom".
    while (!foundEmptyBit) {
      try {
        const bitmap = await this.accessHubNonceStore(
          signerAddress,
          searchFrom,
          hubContract
        );

        // Find index of empty bit
        bitToFlip = this.findEmptyBit(bitmap);

        // Did we find out? -1 implies not found.
        if (bitToFlip.eq(new BigNumber("-1"))) {
          searchFrom = searchFrom.add(1);
        } else {
          foundEmptyBit = true;

          // Record new index
          this.indexTracker.set(signerAddress, searchFrom);

          // Lets flip it internally and keep track of it.
          const flipped = this.flipBit(bitmap, bitToFlip);
          this.bitmapTracker.set(signerAddress, flipped);
        }
      } catch (e) {
        // Possibly an infura rate-limiting error, hold back and try again.
        await wait(1000);
      }
    }

    return { index: searchFrom, bitToFlip };
  }
  /**
   * A simple function that returns the index of the first 0 bit in the bitmap.
   * @param bitmap Bitmap to find an empty bit.
   */
  private findEmptyBit(bitmap: BigNumber) {
    for (let i = 0; i < 256; i++) {
      const flipped = this.flipBit(bitmap, new BigNumber(i));

      // TODO: This might blow up if bitmap is full. Need to think of how to do it without .toNumber()
      if ((bitmap.toNumber() & flipped.toNumber()) != flipped.toNumber()) {
        return new BigNumber(i);
      }
    }
    return new BigNumber("-1");
  }

  /**
   * Flip a bit!
   * @param bits 256 bits
   * @param toFlip index to flip (0,...,255)
   */
  private flipBit(bits: BigNumber, bitToFlip: BigNumber): BigNumber {
    return new BigNumber(bits).add(new BigNumber(2).pow(bitToFlip));
  }

  /**
   * Fetch latest nonce we can use for the replay protection. It is either taken
   * from the contract directoy or what we have kept in memory.
   * We assume that a transaction is immediately broadcasted if this function is called.
   * @param signer Signer's address
   * @param contractAddress Relay contract's address
   * @param index Concurrency index for reply protection
   */
  private async getBitToFlip(
    signerAddress: string,
    hubContract: Contract
  ): Promise<Nonces> {
    // Try using a recently fetched bitmap.
    if (
      this.indexTracker.has(signerAddress) &&
      this.bitmapTracker.has(signerAddress)
    ) {
      const recordedIndex = this.indexTracker.get(signerAddress)!;
      const recordedBitmap = this.bitmapTracker.get(signerAddress)!;
      const bitToFlip = this.findEmptyBit(recordedBitmap);

      // Did we find an empty bit?
      if (!bitToFlip.eq(new BigNumber("-1"))) {
        // Lets flip it internally and keep track of it.
        const flipped = this.flipBit(recordedBitmap, bitToFlip);
        this.bitmapTracker.set(signerAddress, flipped);

        return { index: recordedIndex, latestNonce: bitToFlip };
      }
    }
    // Find the next empty bit.
    // Note; searchBitmaps auto-updates the indexTracker, so we don't have too.
    const { index, bitToFlip } = await this.searchBitmaps(
      signerAddress,
      hubContract
    );

    return { index, latestNonce: bitToFlip };
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
    const nonces: Nonces = await this.getBitToFlip(signerAddress, hubContract);
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
