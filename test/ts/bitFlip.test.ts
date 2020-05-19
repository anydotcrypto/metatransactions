import "mocha";
import * as chai from "chai";
import { solidity, loadFixture } from "ethereum-waffle";
import { BigNumber, defaultAbiCoder, bigNumberify } from "ethers/utils";
import { RelayHubFactory } from "../../src";
import { Provider } from "ethers/providers";
import { Wallet } from "ethers/wallet";
import { BitFlipReplayProtection } from "../../src/ts/replayProtection/bitFlip";
import { deployMetaTxContracts } from "../../src";
import BN from "bn.js";
import { flipBit } from "../utils/test-utils";

const expect = chai.expect;
chai.use(solidity);

async function createRelayHub(provider: Provider, [admin]: Wallet[]) {
  const { relayHubAddress } = await deployMetaTxContracts(admin);

  const relayHub = new RelayHubFactory(admin).attach(relayHubAddress);
  return {
    relayHub,
    admin,
  };
}

describe("Bitflip Module", () => {
  it("Flip every bit", async () => {
    const { relayHub, admin } = await loadFixture(createRelayHub);

    const bitflip = new BitFlipReplayProtection(admin, relayHub.address);
    const bitmap = new BigNumber("0");

    let binary = "1";
    for (let i = 0; i < 255; i++) {
      const flipped = bitflip.flipBit(bitmap, i);

      const flippedBN = new BN(flipped.toString());
      const binaryToBN = new BN(binary, 2);

      expect(flippedBN.toString(2)).to.eq(binaryToBN.toString(2));
      binary = binary + "0";
    }
  }).timeout(50000);

  it("1st bit is empty", async () => {
    const { relayHub, admin } = await loadFixture(createRelayHub);

    const bitflip = new BitFlipReplayProtection(admin, relayHub.address);
    let bitmap = new BigNumber("0");

    const bitToFlip = bitflip.findEmptyBit(bitmap);

    expect(bitToFlip.toString()).to.eq(new BigNumber("0").toString());
  }).timeout(50000);

  it("11th bit is empty", async () => {
    const { relayHub, admin } = await loadFixture(createRelayHub);

    const bitflip = new BitFlipReplayProtection(admin, relayHub.address);
    let bitmap = new BigNumber("0");

    let binary = "1";
    for (let i = 0; i < 10; i++) {
      bitmap = bitflip.flipBit(bitmap, i);

      const bitmapBN = new BN(bitmap.toString());
      const binaryToBN = new BN(binary, 2);

      expect(bitmapBN.toString(2)).to.eq(binaryToBN.toString(2));
      binary = binary + "1";
    }

    const bitToFlip = bitflip.findEmptyBit(bitmap);

    expect(bitToFlip.toString()).to.eq(new BigNumber("10").toString());
  }).timeout(50000);

  it("201th bit is empty", async () => {
    const { relayHub, admin } = await loadFixture(createRelayHub);

    const bitflip = new BitFlipReplayProtection(admin, relayHub.address);
    let bitmap = new BigNumber("0");

    let binary = "1";
    for (let i = 0; i < 200; i++) {
      bitmap = bitflip.flipBit(bitmap, i);

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
    const { relayHub, admin } = await loadFixture(createRelayHub);

    const bitflip = new BitFlipReplayProtection(admin, relayHub.address);
    let bitmap = new BigNumber("0");

    bitmap = bitflip.flipBit(bitmap, 0);
    bitmap = bitflip.flipBit(bitmap, 9);
    bitmap = bitflip.flipBit(bitmap, 199);

    const bitToFlip = bitflip.findEmptyBit(bitmap);

    expect(bitToFlip.toString()).to.eq(new BigNumber("1").toString());
  }).timeout(50000);

  it("flip more than 2560 times to ensure it will m it moves queue when the previous queue is exhausted", async () => {
    const { relayHub, admin } = await loadFixture(createRelayHub);

    const bitflip = new BitFlipReplayProtection(admin, relayHub.address);

    let lastIndex = new BigNumber("-1");
    // Flip every bit
    // i = bit to flip in the map
    for (let i = 0; i < 2560; i++) {
      const encodedNonces = await bitflip.getEncodedReplayProtection();
      const nonces = defaultAbiCoder.decode(["uint", "uint"], encodedNonces);

      const index = i % 256;
      const flipped = flipBit(new BigNumber("0"), new BigNumber(index));
      expect(nonces[1]).to.eq(flipped);

      // Verify the index was indeed changed.
      // We expect it to increment by 1 after
      // the initial random index is chosen
      if (i === 0) {
        lastIndex = nonces[0];
      } else if (index === 0) {
        expect(nonces[0]).to.eq(lastIndex.add(1));
        lastIndex = nonces[0];
      }
    }
  }).timeout(50000);
});
