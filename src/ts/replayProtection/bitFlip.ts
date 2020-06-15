import { defaultAbiCoder, BigNumber, BigNumberish } from "ethers/utils";
import { Signer } from "ethers";
import { ReplayProtectionAuthority } from "./replayProtectionAuthority";
import { Lock } from "@pisa-research/utils";
import BN from "bn.js";

/**
 * The signer can flip a bit for every new transaction. Each
 * queue supports 256 bit flips. It only supports concurrent &
 * out-of-order transactions (e.g. processsing 10000 withdrawals).
 */
export class BitFlipReplayProtection extends ReplayProtectionAuthority {
  public get index() {
    return this.mIndex;
  }

  public get bitmap() {
    return this.mBitmap;
  }

  private mIndex: BigNumber; // Keep track of bitmap index
  private mBitmap: BigNumber;
  private readonly lock: Lock;

  /**
   * BitFlip replay protection for a single wallet
   * @param signer Signer's wallet
   * @param forwarderAddress RelayHub or ProxyAccount address
   */
  constructor(signer: Signer, forwarderAddress: string) {
    super(
      signer,
      forwarderAddress,
      "0x0000000000000000000000000000000000000001"
    );
    this.lock = new Lock();
  }

  /**
   * Search through all bitmaps stored in the contract until we find an empty bit.
   * @param signerAddress Signer's address
   * @param contract RelayHub or ProxyAccount
   * @param searchFrom Starting bitmap index
   */
  private async searchBitmaps() {
    let bitToFlip: number;

    // Lets confirm they are defined
    if (!this.mIndex || !this.mBitmap) {
      const min = 0; // Magic number to separate MultiNonce and BitFlip
      const max = Number.MAX_SAFE_INTEGER;
      // Would prefer something better than Math.random()
      this.mIndex = new BigNumber(
        Math.floor(Math.random() * (max - min + 1) + min)
      );
      this.mBitmap = await this.accessNonceStore(this.mIndex);
    }

    // Let's try to find an empty bit for 30 indexes
    // If it fails after that... something bad happened
    // with the random number generator.
    for (let i = 0; i < 30; i++) {
      // Try to find an empty bit
      bitToFlip = this.findEmptyBit(this.mBitmap);

      // Did we find one?
      if (bitToFlip === -1) {
        // No, let's try the next bitmap
        this.mIndex = this.mIndex.add(1);
        this.mBitmap = await this.accessNonceStore(this.mIndex);
      } else {
        const flippedWithBitmap = this.flipBit(this.mBitmap, bitToFlip);
        this.mBitmap = flippedWithBitmap;
        const newIndex = this.mIndex;
        const singleBitFlipped = this.flipBit(new BigNumber("0"), bitToFlip);
        return { newIndex, singleBitFlipped };
      }
    }

    throw new Error("Failed to find an index with an empty bitmap");
  }
  /**
   * A simple function that returns the index of the first 0 bit in the bitmap.
   * @param bitmap Bitmap to find an empty bit.
   */
  public findEmptyBit(bitmap: BigNumber): number {
    const bitmapBN = new BN(bitmap.toString());
    let c = new BN(1);

    for (let i = 0; i < 256; i++) {
      if (bitmapBN.and(c).isZero()) {
        return i;
      }
      c = c.add(c);
    }
    return -1;
  }

  /**
   * Flip a bit!
   * @param bits 256 bits
   * @param toFlip index to flip (0,...,255)
   */
  public flipBit(bits: BigNumber, bitToFlip: number): BigNumber {
    return new BigNumber(bits).add(new BigNumber(2).pow(bitToFlip));
  }

  /**
   * Fetches and encodes the latest nonce for this signer
   * Note: If the contract address changes, we will refresh the nonce tracker
   * and freshly request new nonces from the network.
   * @param signerAddress Signer's address
   * @param contract RelayHub or Proxy Account
   */
  public async getEncodedReplayProtection() {
    try {
      await this.lock.acquire();
      const { newIndex, singleBitFlipped } = await this.searchBitmaps();
      return defaultAbiCoder.encode(
        ["uint", "uint"],
        [newIndex, singleBitFlipped]
      );
    } finally {
      this.lock.release();
    }
  }
}
