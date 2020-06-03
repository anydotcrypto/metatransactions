import "mocha";
import * as chai from "chai";
import { solidity, loadFixture } from "ethereum-waffle";

import { fnIt } from "@pisa-research/test-utils";
import { ChainID, SingleSignerFactory, SingleSigner } from "../../src";
import { Provider } from "ethers/providers";
import { Wallet } from "ethers/wallet";
import { defaultAbiCoder, keccak256, arrayify, BigNumber } from "ethers/utils";
import { AddressZero } from "ethers/constants";
import { Contract } from "ethers";

const expect = chai.expect;
chai.use(solidity);

let dummyAccount: SingleSigner;
type singleSignerFunctions = typeof dummyAccount.functions;

async function signCall(
  replayProtection: Contract,
  replayProtectionAuthority: string,
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
    ["bytes", "bytes", "address", "address", "uint"],
    [
      callData,
      encodedReplayProtection,
      replayProtectionAuthority,
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

async function createSingleSigner(
  provider: Provider,
  [admin, owner]: Wallet[]
) {
  const singleSigner = await new SingleSignerFactory(admin).deploy();

  return {
    provider,
    singleSigner,
    admin,
    owner,
  };
}

describe("SingleSigner", () => {
  fnIt<singleSignerFunctions>(
    (a) => a.authenticate,
    "authenticate does not revert and thus the signature verification passes",
    async () => {
      const { singleSigner, admin } = await loadFixture(createSingleSigner);

      await singleSigner.init(admin.address);

      expect(await singleSigner.owner()).to.eq(admin.address);

      const messageHash = keccak256(
        defaultAbiCoder.encode(["string"], ["hello"])
      );
      const signedMessage = await admin.signMessage(arrayify(messageHash));

      await expect(singleSigner.authenticate(messageHash, signedMessage)).not.to
        .be.reverted;
    }
  );

  fnIt<singleSignerFunctions>(
    (a) => a.authenticate,
    "the signer did not sign this message and thus authenticate reverts.",
    async () => {
      const { singleSigner, admin } = await loadFixture(createSingleSigner);

      await singleSigner.init(admin.address);
      const messageHash = keccak256(
        defaultAbiCoder.encode(["string"], ["hello"])
      );
      const signedMessage = await admin.signMessage(arrayify(messageHash));

      await expect(
        singleSigner.authenticate(keccak256(messageHash), signedMessage)
      ).to.be.revertedWith(
        "Owner of the proxy account did not authorise the tx"
      );
    }
  );

  fnIt<singleSignerFunctions>(
    (a) => a.authenticate,
    "forgot to init() the single signer and the signature verification fails",
    async () => {
      const { singleSigner, admin } = await loadFixture(createSingleSigner);

      const messageHash = keccak256(
        defaultAbiCoder.encode(["string"], ["hello"])
      );
      const signedMessage = await admin.signMessage(arrayify(messageHash));

      await expect(singleSigner.authenticate(messageHash, signedMessage)).to.be
        .reverted;
    }
  );
});
