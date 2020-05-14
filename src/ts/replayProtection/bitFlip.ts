import { defaultAbiCoder, BigNumber } from "ethers/utils";
import { Wallet } from "ethers";
import { ReplayProtectionAuthority } from "./replayProtectionAuthority";
import { Lock } from "@pisa-research/utils";
import BN from "bn.js";

/**
 * We re-purpose the on-chai nonce (uint) as a bitmap
 * and simply flip bits in the map. It only supports
 * concurrent transactions (e.g. processing 1000 withdrawals, order
 * does not matter).
 */
export class BitFlipReplayProtection extends ReplayProtectionAuthority {
  private index: BigNumber; // Keep track of bitmap index
  private bitmap: BigNumber;
  private readonly lock: Lock;

  /**
   * BitFlip replay protection for a single wallet
   * @param signer Signer's wallet
   * @param forwarderAddress RelayHub or ProxyAccount address
   */
  constructor(signer: Wallet, forwarderAddress: string) {
    super(signer, forwarderAddress);
    this.lock = new Lock();
  }

  /**
   * Search through all bitmaps stored in the contract until we find an empty bit.
   * @param signerAddress Signer's address
   * @param contract RelayHub or ProxyAccount
   * @param searchFrom Starting bitmap index
   */
  private async searchBitmaps() {
    let foundEmptyBit = false;
    let bitToFlip = new BigNumber("0");

    // Lets confirm they are defined
    if (!this.index || !this.bitmap) {
      const min = 6174; // Magic number to separate MultiNonce and BitFlip
      const max = Number.MAX_SAFE_INTEGER;
      // Would prefer something better than Math.random()
      this.index = new BigNumber(
        Math.floor(Math.random() * (max - min + 1) + min)
      );
      this.bitmap = await this.accessNonceStore(this.index);
    }

    // Let's try to find an empty bit for 30 indexes
    // If it fails after that... something bad happened
    // with the random number generator.
    for (let i = 0; i < 30; i) {
      // Try to find an empty bit
      bitToFlip = this.findEmptyBit(this.bitmap);

      // Did we find one?
      if (bitToFlip.eq(new BigNumber("-1"))) {
        // No, let's try the next bitmap
        this.index = this.index.add(1);
        this.bitmap = await this.accessNonceStore(this.index);
      } else {
        // We found an empty bit
        foundEmptyBit = true;

        const flipped = this.flipBit(this.bitmap, bitToFlip);
        this.bitmap = flipped;
        const newIndex = this.index;
        return { newIndex, bitToFlip };
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
  public async getEncodedReplayProtection() {
    try {
      this.lock.acquire();
      const { newIndex, bitToFlip } = await this.searchBitmaps();
      return defaultAbiCoder.encode(["uint", "uint"], [newIndex, bitToFlip]);
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
