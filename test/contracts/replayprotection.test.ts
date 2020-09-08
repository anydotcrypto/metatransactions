import "mocha";
import * as chai from "chai";
import { solidity, loadFixture } from "ethereum-waffle";

import { fnIt } from "@pisa-research/test-utils";
import {
  ReplayProtectionWrapperFactory,
  ReplayProtectionWrapper,
  ChainID,
  ReplayProtectionType,
} from "../../src";
import { Provider } from "ethers/providers";
import { Wallet } from "ethers/wallet";
import { defaultAbiCoder, keccak256, arrayify, BigNumber } from "ethers/utils";
import { Contract } from "ethers";
import BN from "bn.js";
import { flipBit } from "../utils/test-utils";

const expect = chai.expect;
chai.use(solidity);

let dummyAccount: ReplayProtectionWrapper;
type replayProtection = typeof dummyAccount.functions;

async function signCall(
  replayProtection: Contract,
  replayProtectionType: ReplayProtectionType,
  signer: Wallet,
  nonce1: number,
  nonce2: number
) {
  const callData = "0x00000123123123123";
  const encodedReplayProtection = defaultAbiCoder.encode(
    ["uint", "uint"],
    [nonce1, nonce2]
  );

  const encodedMessage = defaultAbiCoder.encode(
    ["bytes", "bytes", "uint", "address", "uint"],
    [
      callData,
      encodedReplayProtection,
      replayProtectionType,
      replayProtection.address,
      ChainID.MAINNET,
    ]
  );

  const txid = keccak256(encodedMessage);
  const signedCall = await signer.signMessage(arrayify(txid));

  return {
    callData,
    encodedReplayProtection,
    signedCall,
    txid,
  };
}

async function createReplayProtection(
  provider: Provider,
  [admin, owner, sender]: Wallet[]
) {
  const replayProtection = await new ReplayProtectionWrapperFactory(
    admin
  ).deploy();

  return {
    provider,
    replayProtection,
    admin,
    owner,
    sender,
  };
}

describe("ReplayProtection", () => {
  fnIt<replayProtection>(
    (a) => a.noncePublic,
    "increment a single queue once to test NONCE",
    async () => {
      const { replayProtection, admin } = await loadFixture(
        createReplayProtection
      );

      const nonceReplayProtection = defaultAbiCoder.encode(
        ["uint", "uint"],
        [0, 0]
      );

      await replayProtection.noncePublic(nonceReplayProtection, admin.address);

      const index = keccak256(
        defaultAbiCoder.encode(
          ["address", "uint", "uint"],
          [admin.address, 0, ReplayProtectionType.MULTINONCE]
        )
      );
      const storedNonce = await replayProtection.nonceStore(index);

      expect(storedNonce.toNumber()).to.eq(1);
    }
  );

  fnIt<replayProtection>(
    (a) => a.noncePublic,
    "increment a single queue multiple times to test NONCE",
    async () => {
      const { replayProtection, admin } = await loadFixture(
        createReplayProtection
      );

      const queue = 0;
      for (let i = 0; i < 50; i++) {
        const nonceReplayProtection = defaultAbiCoder.encode(
          ["uint", "uint"],
          [queue, i]
        );

        await replayProtection.noncePublic(
          nonceReplayProtection,
          admin.address
        );

        const index = keccak256(
          defaultAbiCoder.encode(
            ["address", "uint", "uint"],
            [admin.address, queue, ReplayProtectionType.MULTINONCE]
          )
        );
        const storedNonce = await replayProtection.nonceStore(index);

        expect(storedNonce.toNumber()).to.eq(i + 1);
      }
    }
  ).timeout("20000");

  fnIt<replayProtection>(
    (a) => a.noncePublic,
    "only increment 50 queues once to test MULTINONCE",
    async () => {
      const { replayProtection, admin } = await loadFixture(
        createReplayProtection
      );

      const queueNonce = 0;
      for (let queue = 0; queue < 50; queue++) {
        const nonceReplayProtection = defaultAbiCoder.encode(
          ["uint", "uint"],
          [queue, queueNonce]
        );

        await replayProtection.noncePublic(
          nonceReplayProtection,
          admin.address
        );

        const index = keccak256(
          defaultAbiCoder.encode(
            ["address", "uint", "uint"],
            [admin.address, queue, ReplayProtectionType.MULTINONCE]
          )
        );
        const storedNonce = await replayProtection.nonceStore(index);

        expect(storedNonce.toNumber()).to.eq(1);
      }
    }
  ).timeout("20000");

  fnIt<replayProtection>(
    (a) => a.noncePublic,
    "increment 20 queues at least 20 times to test MULTINONCE",
    async () => {
      const { replayProtection, admin } = await loadFixture(
        createReplayProtection
      );

      for (let queue = 0; queue < 20; queue++) {
        for (let queueNonce = 0; queueNonce < 20; queueNonce++) {
          const nonceReplayProtection = defaultAbiCoder.encode(
            ["uint", "uint"],
            [queue, queueNonce]
          );

          await replayProtection.noncePublic(
            nonceReplayProtection,
            admin.address
          );

          const index = keccak256(
            defaultAbiCoder.encode(
              ["address", "uint", "uint"],
              [admin.address, queue, ReplayProtectionType.MULTINONCE]
            )
          );
          const storedNonce = await replayProtection.nonceStore(index);

          expect(storedNonce.toNumber()).to.eq(queueNonce + 1);
        }
      }
    }
  ).timeout("50000");

  fnIt<replayProtection>(
    (a) => a.verifyPublic,
    "access nonce() via verify",
    async () => {
      const { replayProtection, admin } = await loadFixture(
        createReplayProtection
      );

      const { encodedReplayProtection } = await signCall(
        replayProtection,
        ReplayProtectionType.MULTINONCE,
        admin,
        0,
        0
      );

      const index = keccak256(
        defaultAbiCoder.encode(
          ["address", "uint", "uint"],
          [admin.address, 0, ReplayProtectionType.MULTINONCE]
        )
      );

      await replayProtection.verifyPublic(
        encodedReplayProtection,
        ReplayProtectionType.MULTINONCE,
        admin.address
      );

      const nonce = await replayProtection.nonceStore(index);

      expect(nonce).to.eq(1);
    }
  );

  fnIt<replayProtection>(
    (a) => a.verifyPublic,
    "for nonce() the same replay protection is used twice and should fail",
    async () => {
      const { replayProtection, admin } = await loadFixture(
        createReplayProtection
      );

      const { encodedReplayProtection } = await signCall(
        replayProtection,
        ReplayProtectionType.MULTINONCE,
        admin,
        0,
        0
      );

      const index = keccak256(
        defaultAbiCoder.encode(
          ["address", "uint", "uint"],
          [admin.address, 0, ReplayProtectionType.MULTINONCE]
        )
      );

      await replayProtection.verifyPublic(
        encodedReplayProtection,
        ReplayProtectionType.MULTINONCE,
        admin.address
      );

      const nonce = await replayProtection.nonceStore(index);

      expect(nonce).to.eq(1);

      const tx = replayProtection.verifyPublic(
        encodedReplayProtection,
        ReplayProtectionType.MULTINONCE,
        admin.address
      );

      await expect(tx).to.be.revertedWith(
        "Multinonce replay protection failed"
      );
    }
  );

  fnIt<replayProtection>(
    (a) => a.verifyPublic,
    "for nonce(), the nonce is used (nonce==1) is not yet valid (out of order) and should fail",
    async () => {
      const { replayProtection, admin } = await loadFixture(
        createReplayProtection
      );

      const { encodedReplayProtection } = await signCall(
        replayProtection,
        ReplayProtectionType.MULTINONCE,
        admin,
        0,
        1
      );

      const tx = replayProtection.verifyPublic(
        encodedReplayProtection,
        ReplayProtectionType.MULTINONCE,
        admin.address
      );

      await expect(tx).to.be.revertedWith(
        "Multinonce replay protection failed"
      );
    }
  );

  fnIt<replayProtection>(
    (a) => a.verifyPublic,
    "access nonce() via verify fails as the nonce queue (nonce1) is the wrong replay protection type.",
    async () => {
      const { replayProtection, admin } = await loadFixture(
        createReplayProtection
      );

      const { encodedReplayProtection } = await signCall(
        replayProtection,
        ReplayProtectionType.MULTINONCE,
        admin,
        0,
        1
      );

      const tx = replayProtection.verifyPublic(
        encodedReplayProtection,
        ReplayProtectionType.MULTINONCE,
        admin.address
      );

      await expect(tx).to.be.revertedWith(
        "Multinonce replay protection failed"
      );
    }
  );

  fnIt<replayProtection>(
    (a) => a.verifyPublic,
    "access a non-existing replay protection type and it should fail",
    async () => {
      const { replayProtection, admin } = await loadFixture(
        createReplayProtection
      );

      const { encodedReplayProtection } = await signCall(
        replayProtection,
        2,
        admin,
        0,
        0
      );

      await expect(
        replayProtection.verifyPublic(encodedReplayProtection, 2, admin.address)
      ).to.be.reverted;
    }
  );

  fnIt<replayProtection>(
    (a) => a.bitflipPublic,
    "flip a single bit to test BITFLIP",
    async () => {
      const { replayProtection, admin } = await loadFixture(
        createReplayProtection
      );

      const bitmapIndex = 6175;

      const flippedBit = flipBit(new BigNumber("0"), new BigNumber("0"));
      const nonceReplayProtection = defaultAbiCoder.encode(
        ["uint", "uint"],
        [bitmapIndex, flippedBit]
      );

      await replayProtection.bitflipPublic(
        nonceReplayProtection,
        admin.address
      );

      const index = keccak256(
        defaultAbiCoder.encode(
          ["address", "uint", "uint"],
          [admin.address, bitmapIndex, ReplayProtectionType.BITFLIP]
        )
      );

      const storedNonce = await replayProtection.nonceStore(index);
      expect(storedNonce.toNumber()).to.eq(flippedBit);
    }
  );

  fnIt<replayProtection>(
    (a) => a.bitflipPublic,
    "try to flip 0 bits and it should fail",
    async () => {
      const { replayProtection, admin } = await loadFixture(
        createReplayProtection
      );

      const bitmapIndex = 6175;

      const nonceReplayProtection = defaultAbiCoder.encode(
        ["uint", "uint"],
        [bitmapIndex, new BigNumber("0")]
      );

      await expect(
        replayProtection.bitflipPublic(nonceReplayProtection, admin.address)
      ).to.be.revertedWith("It must flip one bit!");
    }
  );

  fnIt<replayProtection>(
    (a) => a.bitflipPublic,
    "flipping the same bit twice for BITFLIP should not update nonce in the the noncestore",
    async () => {
      const { replayProtection, admin } = await loadFixture(
        createReplayProtection
      );

      const bitmapIndex = 6175;

      const flippedBit = flipBit(new BigNumber("0"), new BigNumber("0"));
      const nonceReplayProtection = defaultAbiCoder.encode(
        ["uint", "uint"],
        [bitmapIndex, flippedBit]
      );

      await replayProtection.bitflipPublic(
        nonceReplayProtection,
        admin.address
      );

      const index = keccak256(
        defaultAbiCoder.encode(
          ["address", "uint", "uint"],
          [admin.address, bitmapIndex, ReplayProtectionType.BITFLIP]
        )
      );

      let storedNonce = await replayProtection.nonceStore(index);
      expect(storedNonce.toNumber()).to.eq(flippedBit);

      await replayProtection.bitflipPublic(
        nonceReplayProtection,
        admin.address
      );

      storedNonce = await replayProtection.nonceStore(index);
      expect(storedNonce.toNumber()).to.eq(flippedBit);
    }
  );

  fnIt<replayProtection>(
    (a) => a.bitflipPublic,
    "flip several bits and all bits should be recorded in the stored bitmap",
    async () => {
      const { replayProtection, admin } = await loadFixture(
        createReplayProtection
      );

      const bitmapIndex = 6175;

      // Flip the 1st bit
      const flipBit1 = flipBit(new BigNumber("0"), new BigNumber("0"));
      await replayProtection.bitflipPublic(
        defaultAbiCoder.encode(["uint", "uint"], [bitmapIndex, flipBit1]),
        admin.address
      );

      const index = keccak256(
        defaultAbiCoder.encode(
          ["address", "uint", "uint"],
          [admin.address, bitmapIndex, ReplayProtectionType.BITFLIP]
        )
      );

      let storedNonce = await replayProtection.nonceStore(index);
      expect(storedNonce.toNumber()).to.eq(flipBit1);

      // Flip the 10th bit
      const flipBit10 = flipBit(new BigNumber("0"), new BigNumber("10"));
      await replayProtection.bitflipPublic(
        defaultAbiCoder.encode(["uint", "uint"], [bitmapIndex, flipBit10]),
        admin.address
      );

      storedNonce = await replayProtection.nonceStore(index);
      let totalFlipped = flipBit(flipBit1, new BigNumber("10"));
      expect(storedNonce).to.eq(totalFlipped);

      // Flip the 200th bit
      const flipBit200 = flipBit(new BigNumber("0"), new BigNumber("200"));
      await replayProtection.bitflipPublic(
        defaultAbiCoder.encode(["uint", "uint"], [bitmapIndex, flipBit200]),
        admin.address
      );

      storedNonce = await replayProtection.nonceStore(index);
      totalFlipped = flipBit(totalFlipped, new BigNumber("200"));
      expect(storedNonce).to.eq(totalFlipped);
    }
  );

  fnIt<replayProtection>(
    (a) => a.verifyPublic,
    "access bitflip() via verify (e.g. the replay protection type)",
    async () => {
      const { replayProtection, admin } = await loadFixture(
        createReplayProtection
      );

      const bitmapIndex = 123;
      const bitToFlip = flipBit(new BigNumber("0"), new BigNumber("0"));

      const { encodedReplayProtection } = await signCall(
        replayProtection,
        ReplayProtectionType.BITFLIP,
        admin,
        bitmapIndex,
        bitToFlip.toNumber()
      );

      const index = keccak256(
        defaultAbiCoder.encode(
          ["address", "uint", "uint"],
          [admin.address, bitmapIndex, ReplayProtectionType.BITFLIP]
        )
      );

      await replayProtection.verifyPublic(
        encodedReplayProtection,
        ReplayProtectionType.BITFLIP,
        admin.address
      );

      const nonce = await replayProtection.nonceStore(index);

      expect(nonce).to.eq(bitToFlip);
    }
  );

  fnIt<replayProtection>(
    (a) => a.verifyPublic,
    "access bitflip() via verify with wrong replay protection type and it should fail",
    async () => {
      const { replayProtection, admin } = await loadFixture(
        createReplayProtection
      );

      const bitmapIndex = 6175;
      const bitToFlip = flipBit(new BigNumber("0"), new BigNumber("0"));

      const { encodedReplayProtection } = await signCall(
        replayProtection,
        ReplayProtectionType.MULTINONCE,
        admin,
        bitmapIndex,
        bitToFlip.toNumber()
      );

      await expect(
        replayProtection.verifyPublic(
          encodedReplayProtection,
          ReplayProtectionType.MULTINONCE,
          admin.address
        )
      ).to.be.revertedWith("Multinonce replay protection failed");
    }
  );
  fnIt<replayProtection>(
    (a) => a.verifyPublic,
    "submit same replay protection for bitflip() twice and it should fail",
    async () => {
      const { replayProtection, admin } = await loadFixture(
        createReplayProtection
      );

      const bitmapIndex = 321;
      const bitToFlip = flipBit(new BigNumber("0"), new BigNumber("0"));

      const { callData, encodedReplayProtection, signedCall } = await signCall(
        replayProtection,
        ReplayProtectionType.BITFLIP,
        admin,
        bitmapIndex,
        bitToFlip.toNumber()
      );

      await replayProtection.verifyPublic(
        encodedReplayProtection,
        ReplayProtectionType.BITFLIP,
        admin.address
      );

      const index = keccak256(
        defaultAbiCoder.encode(
          ["address", "uint", "uint"],
          [admin.address, bitmapIndex, ReplayProtectionType.BITFLIP]
        )
      );
      const nonce = await replayProtection.nonceStore(index);

      expect(nonce).to.eq(bitToFlip);

      await expect(
        replayProtection.verifyPublic(
          encodedReplayProtection,
          ReplayProtectionType.BITFLIP,
          admin.address
        )
      ).to.be.revertedWith("Bitflip replay protection failed");
    }
  );

  function isPowerOfTwo(n: BigNumber) {
    const bn = new BN(n.toString());
    return bn.and(bn.sub(new BN("1"))).eq(new BN("0"));
  }

  fnIt<replayProtection>(
    (a) => a.verifyPublic,
    "test isPowerOfTwo",
    async () => {
      // As long as one argument is zero, it should always work.
      for (let i = 0; i < 256; i++) {
        const flipped = flipBit(new BigNumber("0"), new BigNumber(i));
        expect(isPowerOfTwo(flipped)).to.be.true;
        expect(flipped).not.eq(new BigNumber("0"));
      }

      // More than one bit is flipped, it should always fail.
      for (let i = 1; i < 256; i++) {
        const flipped = flipBit(new BigNumber("1"), new BigNumber(i));
        expect(isPowerOfTwo(flipped)).to.be.false;
      }
    }
  );

  fnIt<replayProtection>(
    (a) => a.verifyPublic,
    "flips two bits for bitflip for a single job and it should fail",
    async () => {
      const { replayProtection, admin } = await loadFixture(
        createReplayProtection
      );

      let bitmapIndex = 2;
      let bitToFlip = flipBit(new BigNumber("0"), new BigNumber("0"));
      bitToFlip = flipBit(bitToFlip, new BigNumber("1"));

      const { encodedReplayProtection } = await signCall(
        replayProtection,
        ReplayProtectionType.BITFLIP,
        admin,
        bitmapIndex,
        bitToFlip.toNumber()
      );

      await expect(
        replayProtection.verifyPublic(
          encodedReplayProtection,
          ReplayProtectionType.BITFLIP,
          admin.address
        )
      ).to.be.revertedWith("Only a single bit can be flipped");

      const index = keccak256(
        defaultAbiCoder.encode(
          ["address", "uint", "address"],
          [
            admin.address,
            bitmapIndex,
            "0x0000000000000000000000000000000000000001",
          ]
        )
      );
      const nonce = await replayProtection.nonceStore(index);

      expect(nonce).to.eq(new BigNumber("0"));
    }
  );

  fnIt<replayProtection>(
    (a) => a.verifyPublic,
    "flip a bit and add 1. use the modified bit to flip and it should fail.",
    async () => {
      const { replayProtection, admin } = await loadFixture(
        createReplayProtection
      );

      let bitmapIndex = 2;
      let bitToFlip = flipBit(new BigNumber("0"), new BigNumber("5"));
      bitToFlip = bitToFlip.add(1);

      const { encodedReplayProtection } = await signCall(
        replayProtection,
        ReplayProtectionType.BITFLIP,
        admin,
        bitmapIndex,
        bitToFlip.toNumber()
      );

      await expect(
        replayProtection.verifyPublic(
          encodedReplayProtection,
          ReplayProtectionType.BITFLIP,
          admin.address
        )
      ).to.be.revertedWith("Only a single bit can be flipped");

      const index = keccak256(
        defaultAbiCoder.encode(
          ["address", "uint", "uint"],
          [admin.address, bitmapIndex, ReplayProtectionType.BITFLIP]
        )
      );
      const nonce = await replayProtection.nonceStore(index);

      expect(nonce).to.eq(new BigNumber("0"));
    }
  );

  fnIt<replayProtection>(
    (a) => a.verifyPublic,
    "submit same replay protection for bitflip() twice and it should fail",
    async () => {
      const { replayProtection, admin } = await loadFixture(
        createReplayProtection
      );

      const bitmapIndex = 321;
      const bitToFlip = flipBit(new BigNumber("0"), new BigNumber("0"));

      const { encodedReplayProtection } = await signCall(
        replayProtection,
        ReplayProtectionType.BITFLIP,
        admin,
        bitmapIndex,
        bitToFlip.toNumber()
      );

      await replayProtection.verifyPublic(
        encodedReplayProtection,
        ReplayProtectionType.BITFLIP,
        admin.address
      );

      const index = keccak256(
        defaultAbiCoder.encode(
          ["address", "uint", "uint"],
          [admin.address, bitmapIndex, ReplayProtectionType.BITFLIP]
        )
      );
      const nonce = await replayProtection.nonceStore(index);

      expect(nonce).to.eq(bitToFlip);

      await expect(
        replayProtection.verifyPublic(
          encodedReplayProtection,
          ReplayProtectionType.BITFLIP,
          admin.address
        )
      ).to.be.revertedWith("Bitflip replay protection failed");
    }
  );

  fnIt<replayProtection>(
    (a) => a.verifyPublic,
    "catch the ReplayProtectionInfo event",
    async () => {
      const { replayProtection, admin } = await loadFixture(
        createReplayProtection
      );

      const { encodedReplayProtection } = await signCall(
        replayProtection,
        ReplayProtectionType.MULTINONCE,
        admin,
        0,
        0
      );

      const tx = replayProtection.verifyPublic(
        encodedReplayProtection,
        ReplayProtectionType.MULTINONCE,
        admin.address
      );

      await expect(tx)
        .to.emit(
          replayProtection,
          replayProtection.interface.events.ReplayProtectionInfo.name
        )
        .withArgs(
          ReplayProtectionType.MULTINONCE,
          encodedReplayProtection,
          admin.address,
          keccak256(defaultAbiCoder.encode(["string"], ["any.sender"]))
        );
    }
  );
});
