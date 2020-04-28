import { defaultAbiCoder, BigNumber } from "ethers/utils";
import { Wallet } from "ethers";
import { ReplayProtectionAuthority } from "./replayprotectionauthority";
import { Lock } from "@pisa-research/utils";
import { wait } from "@pisa-research/test-utils";
import BN from "bn.js";

/**
 * We re-purpose the on-chai nonce (uint) as a bitmap
 * and simply flip bits in the map. It only supports
 * concurrent transactions (e.g. processing 1000 withdrawals, order
 * does not matter).
 */
export class BitFlip extends ReplayProtectionAuthority {
  private indexTracker: Map<string, BigNumber>; // Keep track of bitmap index
  private bitmapTracker: Map<string, BigNumber>; // Keep track of bitmap
  lock: Lock;

  constructor(private readonly contract: string) {
    super();
    this.indexTracker = new Map<string, BigNumber>();
    this.bitmapTracker = new Map<string, BigNumber>();
    this.lock = new Lock();
  }

  /**
   * Search through all bitmaps stored in the contract until we find an empty bit.
   * @param signerAddress Signer's address
   * @param contract RelayHub or ProxyAccount
   * @param searchFrom Starting bitmap index
   */
  private async searchBitmaps(signer: Wallet) {
    let foundEmptyBit = false;
    let index = this.indexTracker.get(signer.address);
    let bitmap = this.bitmapTracker.get(signer.address);
    let bitToFlip = new BigNumber("0");

    // Lets confirm they are defined
    if (!index || !bitmap) {
      const min = 6174; // Magic number to separate MultiNonce and BitFlip
      const max = Number.MAX_SAFE_INTEGER;
      // Would prefer something better than Math.random()
      index = new BigNumber(Math.floor(Math.random() * (max - min + 1) + min));
      bitmap = await this.accessNonceStore(signer, index, this.contract);
    }

    // Let's try to find an empty bit for 1000 indexes
    // If it fails after that... something bad happened
    // with the random number generator.
    for (let i = 0; i < 1000; i) {
      try {
        // Try to find an empty bit
        bitToFlip = this.findEmptyBit(bitmap);

        // Did we find one?
        if (bitToFlip.eq(new BigNumber("-1"))) {
          // No, let's try the next bitmap
          index = index.add(1);
          bitmap = await this.accessNonceStore(signer, index, this.contract);
        } else {
          // We found an empty bit
          foundEmptyBit = true;

          // Keep track of index and new flipped bitmap
          this.indexTracker.set(signer.address, index);
          const flipped = this.flipBit(bitmap, bitToFlip);
          this.bitmapTracker.set(signer.address, flipped);
          return { index, bitToFlip };
        }
      } catch (e) {
        // Likely an error from infura, lets hold back and try again.
        await wait(500);
      }
    }

    throw new Error("Failed to find an index with an empty bitmap");
  }
  /**
   * A simple function that returns the index of the first 0 bit in the bitmap.
   * @param bitmap Bitmap to find an empty bit.
   */
  public findEmptyBit(bitmap: BigNumber) {
    const emptyBitmap = new BigNumber("0");
    for (let i = 0; i < 256; i++) {
      const flipped = this.flipBit(emptyBitmap, new BigNumber(i));

      // Convert BigNumber to BN
      const bitmapBN = new BN(bitmap.toString());
      const flippedBN = new BN(flipped.toString());

      // bitmap & flipped = flipped'
      // If flipped' is 0, then neither bitmap or flipped shared a flipped bit.
      if (bitmapBN.and(flippedBN).eq(new BN("0"))) {
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
  public flipBit(bits: BigNumber, bitToFlip: BigNumber): BigNumber {
    return new BigNumber(bits).add(new BigNumber(2).pow(bitToFlip));
  }

  /**
   * Fetches and encodes the latest nonce for this signer
   * Note: If the contract address changes, we will refresh the nonce tracker
   * and freshly request new nonces from the network.
   * @param signerAddress Signer's address
   * @param contract RelayHub or Proxy Account
   */
  public async getEncodedReplayProtection(signer: Wallet) {
    try {
      this.lock.acquire();
      const { index, bitToFlip } = await this.searchBitmaps(signer);
      return defaultAbiCoder.encode(["uint", "uint"], [index, bitToFlip]);
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
