import "mocha";
import * as chai from "chai";
import { solidity, loadFixture } from "ethereum-waffle";
import {
  hexlify,
  hexZeroPad,
  solidityPack,
  keccak256,
  solidityKeccak256,
} from "ethers/utils";
import { fnIt } from "@pisa-research/test-utils";
import { Provider } from "ethers/providers";
import { Wallet } from "ethers/wallet";
import { BitFlipNonceStoreFactory } from "../../build/BitFlipNonceStoreFactory";
import { BitFlipNonceStore } from "../../build/BitFlipNonceStore";

const expect = chai.expect;
chai.use(solidity);

let dummyBitFlipNonceStore: BitFlipNonceStore;
type bitFlipNonceStoreFunctions = typeof dummyBitFlipNonceStore.functions;

async function createBitFlipNonceStore(
  provider: Provider,
  [admin, sender, target1, target2]: Wallet[]
) {
  const bitFlipNonceStoreFactory = new BitFlipNonceStoreFactory(admin);
  const nonceStore = await bitFlipNonceStoreFactory.deploy();

  return { nonceStore, admin, sender, target1, target2 };
}

export const to32ByteHex = (val: number) => {
  return hexZeroPad(hexlify(val), 32);
};

export const constructNonce = (nonce1: string, nonce2: number) => {
  return solidityPack(["bytes32", "uint256"], [nonce1, to32ByteHex(nonce2)]);
};

export const constructNonce1 = (nonce1: string, senderAddress: string) => {
  return solidityKeccak256(["address", "bytes32"], [senderAddress, nonce1]);
};

export const constructTargetNonce1 = (
  nonce1: string,
  senderAddress: string,
  targetAddress: string
) => {
  return solidityKeccak256(
    ["address", "address", "bytes32"],
    [senderAddress, targetAddress, nonce1]
  );
};

describe("BitFlipNonceStore", () => {
  fnIt<bitFlipNonceStoreFunctions>(
    (a: { update: any }) => a.update,
    "does update nonce",
    async () => {
      const { nonceStore, sender } = await loadFixture(createBitFlipNonceStore);
      const nonce = constructNonce(to32ByteHex(1), 1);

      const tx = await (await nonceStore.connect(sender).update(nonce)).wait();
      expect(tx.gasUsed!.toNumber()).to.be.lessThan(45000);

      expect(
        (
          await nonceStore.bitmaps(
            constructNonce1(to32ByteHex(1), sender.address)
          )
        ).toString()
      ).to.eq("1");
    }
  );

  fnIt<bitFlipNonceStoreFunctions>(
    (a: { update: any }) => a.update,
    "to revert when called twice",
    async () => {
      const { nonceStore, sender } = await loadFixture(createBitFlipNonceStore);
      const nonce = constructNonce(to32ByteHex(1), 1);

      await (await nonceStore.connect(sender).update(nonce)).wait();
      await expect(nonceStore.connect(sender).update(nonce)).to.be.revertedWith(
        "Nonce already used."
      );

      expect(
        (
          await nonceStore.bitmaps(
            constructNonce1(to32ByteHex(1), sender.address)
          )
        ).toString()
      ).to.eq("1");
    }
  );

  fnIt<bitFlipNonceStoreFunctions>(
    (a: { update: any }) => a.update,
    "to successfully update different nonce1",
    async () => {
      const { nonceStore, sender } = await loadFixture(createBitFlipNonceStore);
      const nonceA = constructNonce(to32ByteHex(1), 1);
      const nonceB = constructNonce(to32ByteHex(2), 1);

      await (await nonceStore.connect(sender).update(nonceA)).wait();
      await (await nonceStore.connect(sender).update(nonceB)).wait();

      expect(
        (
          await nonceStore.bitmaps(
            constructNonce1(to32ByteHex(1), sender.address)
          )
        ).toString()
      ).to.eq("1");
      expect(
        (
          await nonceStore.bitmaps(
            constructNonce1(to32ByteHex(2), sender.address)
          )
        ).toString()
      ).to.eq("1");
    }
  );

  fnIt<bitFlipNonceStoreFunctions>(
    (a: { update: any }) => a.update,
    "to successfully update different nonce2",
    async () => {
      const { nonceStore, sender } = await loadFixture(createBitFlipNonceStore);
      const nonceA = constructNonce(to32ByteHex(1), 1);
      const nonceB = constructNonce(to32ByteHex(1), 4);

      const tx1 = await (
        await nonceStore.connect(sender).update(nonceA)
      ).wait();
      const tx2 = await (
        await nonceStore.connect(sender).update(nonceB)
      ).wait();

      const expectedGasCost = 45000;
      // we expect the second update to be cheaper by 15000
      expect(tx1.gasUsed!.toNumber()).to.be.lessThan(expectedGasCost);
      expect(tx2.gasUsed!.toNumber()).to.be.lessThan(expectedGasCost - 15000);

      expect(
        (
          await nonceStore.bitmaps(
            constructNonce1(to32ByteHex(1), sender.address)
          )
        ).toString()
      ).to.eq("5");
    }
  );

  fnIt<bitFlipNonceStoreFunctions>(
    (a: { update: any }) => a.update,
    "to still revert after an update",
    async () => {
      const { nonceStore, sender } = await loadFixture(createBitFlipNonceStore);
      const nonceA = constructNonce(to32ByteHex(1), 1);
      const nonceB = constructNonce(to32ByteHex(1), 2);

      await (await nonceStore.connect(sender).update(nonceA)).wait();
      await (await nonceStore.connect(sender).update(nonceB)).wait();

      expect(
        (
          await nonceStore.bitmaps(
            constructNonce1(to32ByteHex(1), sender.address)
          )
        ).toString()
      ).to.eq("3");
      await expect(
        nonceStore.connect(sender).update(nonceA)
      ).to.be.revertedWith("Nonce already used.");
    }
  );

  fnIt<bitFlipNonceStoreFunctions>(
    (a: { update: any }) => a.update,
    "can use hashed nonce1",
    async () => {
      const { nonceStore, sender } = await loadFixture(createBitFlipNonceStore);
      const nonce = constructNonce(keccak256(nonceStore.address), 1);

      await (await nonceStore.connect(sender).update(nonce)).wait();

      expect(
        (
          await nonceStore.bitmaps(
            constructNonce1(keccak256(nonceStore.address), sender.address)
          )
        ).toString()
      ).to.eq("1");
    }
  );

  fnIt<bitFlipNonceStoreFunctions>(
    (a: { update: any }) => a.update,
    "can update nonce from different senders",
    async () => {
      const { nonceStore, sender, admin } = await loadFixture(
        createBitFlipNonceStore
      );
      const nonce = constructNonce(to32ByteHex(1), 1);

      await (await nonceStore.connect(sender).update(nonce)).wait();
      await (await nonceStore.connect(admin).update(nonce)).wait();

      expect(
        (
          await nonceStore.bitmaps(
            constructNonce1(to32ByteHex(1), sender.address)
          )
        ).toString()
      ).to.eq("1");
      expect(
        (
          await nonceStore.bitmaps(
            constructNonce1(to32ByteHex(1), admin.address)
          )
        ).toString()
      ).to.eq("1");
    }
  );

  fnIt<bitFlipNonceStoreFunctions>(
    (a: { updateFor: any }) => a.updateFor,
    "can update nonce for target",
    async () => {
      const { nonceStore, sender, target1 } = await loadFixture(
        createBitFlipNonceStore
      );
      const nonce = constructNonce(to32ByteHex(1), 1);

      await (
        await nonceStore.connect(sender).updateFor(target1.address, nonce)
      ).wait();

      expect(
        (
          await nonceStore.bitmaps(
            constructTargetNonce1(
              to32ByteHex(1),
              sender.address,
              target1.address
            )
          )
        ).toString()
      ).to.eq("1");
    }
  );

  fnIt<bitFlipNonceStoreFunctions>(
    (a: { updateFor: any }) => a.updateFor,
    "cannot update the nonce twice",
    async () => {
      const { nonceStore, sender, target1, target2 } = await loadFixture(
        createBitFlipNonceStore
      );
      const nonce = constructNonce(to32ByteHex(1), 1);

      await (
        await nonceStore.connect(sender).updateFor(target1.address, nonce)
      ).wait();
      await (
        await nonceStore.connect(sender).updateFor(target2.address, nonce)
      ).wait();

      expect(
        (
          await nonceStore.bitmaps(
            constructTargetNonce1(
              to32ByteHex(1),
              sender.address,
              target1.address
            )
          )
        ).toString()
      ).to.eq("1");
      expect(
        (
          await nonceStore.bitmaps(
            constructTargetNonce1(
              to32ByteHex(1),
              sender.address,
              target2.address
            )
          )
        ).toString()
      ).to.eq("1");
    }
  );

  fnIt<bitFlipNonceStoreFunctions>(
    (a: { updateFor: any }) => a.updateFor,
    "can update nonces for different targets",
    async () => {
      const { nonceStore, sender, target1 } = await loadFixture(
        createBitFlipNonceStore
      );
      const nonce = constructNonce(to32ByteHex(1), 1);

      await (
        await nonceStore.connect(sender).updateFor(target1.address, nonce)
      ).wait();
      await expect(
        nonceStore.connect(sender).updateFor(target1.address, nonce)
      ).to.be.revertedWith("Nonce already used.");

      expect(
        (
          await nonceStore.bitmaps(
            constructTargetNonce1(
              to32ByteHex(1),
              sender.address,
              target1.address
            )
          )
        ).toString()
      ).to.eq("1");
    }
  );

  fnIt<bitFlipNonceStoreFunctions>(
    (a: { updateFor: any }) => a.updateFor,
    "cannot update for different senders",
    async () => {
      const { nonceStore, sender, admin, target1 } = await loadFixture(
        createBitFlipNonceStore
      );
      const nonce = constructNonce(to32ByteHex(1), 1);

      await (
        await nonceStore.connect(sender).updateFor(target1.address, nonce)
      ).wait();
      await (
        await nonceStore.connect(admin).updateFor(target1.address, nonce)
      ).wait();

      expect(
        (
          await nonceStore.bitmaps(
            constructTargetNonce1(
              to32ByteHex(1),
              sender.address,
              target1.address
            )
          )
        ).toString()
      ).to.eq("1");
      expect(
        (
          await nonceStore.bitmaps(
            constructTargetNonce1(
              to32ByteHex(1),
              admin.address,
              target1.address
            )
          )
        ).toString()
      ).to.eq("1");
    }
  );

  fnIt<bitFlipNonceStoreFunctions>(
    (a: { updateFor: any }) => a.updateFor,
    "cannot update nonce for same sender and target, different nonce",
    async () => {
      const { nonceStore, sender, target1 } = await loadFixture(
        createBitFlipNonceStore
      );
      const nonce = constructNonce(to32ByteHex(1), 1);
      const nonce2 = constructNonce(to32ByteHex(1), 2);

      await (
        await nonceStore.connect(sender).updateFor(target1.address, nonce)
      ).wait();
      await (
        await nonceStore.connect(sender).updateFor(target1.address, nonce2)
      ).wait();

      expect(
        (
          await nonceStore.bitmaps(
            constructTargetNonce1(
              to32ByteHex(1),
              sender.address,
              target1.address
            )
          )
        ).toString()
      ).to.eq("3");
    }
  );
});
