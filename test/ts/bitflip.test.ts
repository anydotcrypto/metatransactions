import "mocha";
import * as chai from "chai";
import { solidity, loadFixture } from "ethereum-waffle";
import { BigNumber, defaultAbiCoder } from "ethers/utils";
import { RelayHubFactory } from "../../src";
import { Provider } from "ethers/providers";
import { Wallet } from "ethers/wallet";
import { BitFlip } from "../../src/ts/bitflip";
import BN from "bn.js";

const expect = chai.expect;
chai.use(solidity);

async function createRelayHub(provider: Provider, [admin]: Wallet[]) {
  const relayHubFactory = new RelayHubFactory(admin);
  const relayHubCreationTx = relayHubFactory.getDeployTransaction();

  const relayHubCreation = await admin.sendTransaction(relayHubCreationTx);
  const result = await relayHubCreation.wait(1);

  const relayHub = relayHubFactory.attach(result.contractAddress!);
  return {
    relayHub,
    admin,
  };
}

describe("Bitflip Module", () => {
  it("Flip every bit", async () => {
    const bitflip = new BitFlip();
    const bitmap = new BigNumber("0");

    let binary = "1";
    for (let i = 0; i < 255; i++) {
      const flipped = bitflip.flipBit(bitmap, new BigNumber(i));

      const flippedBN = new BN(flipped.toString());
      const binaryToBN = new BN(binary, 2);

      expect(flippedBN.toString(2)).to.eq(binaryToBN.toString(2));
      binary = binary + "0";
    }
  }).timeout(50000);

  it("1st bit is empty", async () => {
    const bitflip = new BitFlip();
    let bitmap = new BigNumber("0");

    const bitToFlip = bitflip.findEmptyBit(bitmap);

    expect(bitToFlip.toString()).to.eq(new BigNumber("0").toString());
  }).timeout(50000);

  it("11th bit is empty", async () => {
    const bitflip = new BitFlip();
    let bitmap = new BigNumber("0");

    let binary = "1";
    for (let i = 0; i < 10; i++) {
      bitmap = bitflip.flipBit(bitmap, new BigNumber(i));

      const bitmapBN = new BN(bitmap.toString());
      const binaryToBN = new BN(binary, 2);

      expect(bitmapBN.toString(2)).to.eq(binaryToBN.toString(2));
      binary = binary + "1";
    }

    const bitToFlip = bitflip.findEmptyBit(bitmap);

    expect(bitToFlip.toString()).to.eq(new BigNumber("10").toString());
  }).timeout(50000);

  it("201th bit is empty", async () => {
    const bitflip = new BitFlip();
    let bitmap = new BigNumber("0");

    let binary = "1";
    for (let i = 0; i < 200; i++) {
      bitmap = bitflip.flipBit(bitmap, new BigNumber(i));

      const bitmapBN = new BN(bitmap.toString());
      const binaryToBN = new BN(binary, 2);

      expect(bitmapBN.toString(2)).to.eq(binaryToBN.toString(2));
      binary = binary + "1";
    }

    // Bitmap is essentially ~111111111111
    // So we are looking for the next "0" in the 256-bit map.
    const bitToFlip = bitflip.findEmptyBit(bitmap);

    expect(bitToFlip.toString()).to.eq(new BigNumber("200").toString());
  }).timeout(50000);

  it("1st, 10th bit, 200th bit is flipped. It will find the 2nd bit as empty", async () => {
    const bitflip = new BitFlip();
    let bitmap = new BigNumber("0");

    bitmap = bitflip.flipBit(bitmap, new BigNumber("0"));
    bitmap = bitflip.flipBit(bitmap, new BigNumber("9"));
    bitmap = bitflip.flipBit(bitmap, new BigNumber("199"));

    const bitToFlip = bitflip.findEmptyBit(bitmap);

    expect(bitToFlip.toString()).to.eq(new BigNumber("1").toString());
  }).timeout(50000);

  it("get bits to flip in sequence", async () => {
    const { relayHub, admin } = await loadFixture(createRelayHub);

    const bitflip = new BitFlip();

    // Flip every bit
    // j = index of bitmap
    // i = bit to flip in the map
    for (let j = 6174; j < 10; j++) {
      for (let i = 0; i < 256; i++) {
        const encodedNonces = await bitflip.getEncodedReplayProtection(
          admin,
          relayHub.address
        );
        const nonces = defaultAbiCoder.decode(["uint", "uint"], encodedNonces);

        expect(nonces[0]).to.eq(new BigNumber(j));
        expect(nonces[1]).to.eq(new BigNumber(i));
      }
    }
  }).timeout(50000);
});
