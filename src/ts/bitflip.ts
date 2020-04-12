import { defaultAbiCoder, BigNumber } from "ethers/utils";
import { Contract } from "ethers";
import { ReplayProtectionAuthority } from "./replayprotection";
import { wait } from "@pisa-research/test-utils";
import BN from "bn.js";

export class BitFlip extends ReplayProtectionAuthority {
  private indexTracker: Map<string, BigNumber>; // Keep track of bitmap index
  private bitmapTracker: Map<string, BigNumber>; // Keep track of bitmap

  constructor(private readonly hubContract: Contract) {
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
  private async searchBitmaps(signerAddress: string) {
    let foundEmptyBit = false;
    let index = this.indexTracker.get(signerAddress);
    let bitmap = this.bitmapTracker.get(signerAddress);
    let bitToFlip = new BigNumber("0");

    // Lets confirm they are defined
    if (!index || !bitmap) {
      index = new BigNumber("6174");
      bitmap = await this.accessHubNonceStore(
        signerAddress,
        index,
        this.hubContract
      );
    }
    while (!foundEmptyBit) {
      try {
        // Try to find an empty bit
        bitToFlip = this.findEmptyBit(bitmap);

        // Did we find one?
        if (bitToFlip.eq(new BigNumber("-1"))) {
          // No, let's try the next bitmap
          index = index.add(1);
          bitmap = await this.accessHubNonceStore(
            signerAddress,
            index,
            this.hubContract
          );
        } else {
          // We found an empty bit
          foundEmptyBit = true;

          // Keep track of index and new flipped bitmap
          this.indexTracker.set(signerAddress, index);
          const flipped = this.flipBit(bitmap, bitToFlip);
          this.bitmapTracker.set(signerAddress, flipped);
        }
      } catch (e) {
        // Likely an error from infura, lets hold back and try again.
        await wait(500);
      }
    }

    return { index, bitToFlip };
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
   * @param hubContract RelayHub or ContractAccount
   */
  public async getEncodedReplayProtection(signerAddress: string) {
    const { index, bitToFlip } = await this.searchBitmaps(signerAddress);
    return defaultAbiCoder.encode(["uint", "uint"], [index, bitToFlip]);
  }

  /**
   * Return address of replay protection authority
   */
  public getAddress() {
    return "0x0000000000000000000000000000000000000000";
  }
}
