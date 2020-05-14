import "mocha";
import * as chai from "chai";
import { solidity, loadFixture } from "ethereum-waffle";
import { BigNumber, keccak256, arrayify, defaultAbiCoder } from "ethers/utils";
import Doppelganger from "ethereum-doppelganger";

import { fnIt } from "@pisa-research/test-utils";
import {
  RelayHubFactory,
  BitFlipNonceStoreFactory,
  MsgSenderExampleFactory,
  RelayHub,
  IReplayProtectionJson,
  RelayHubForwarderFactory,
  MultiNonceReplayProtection,
  BitFlipReplayProtection,
  RelayHubForwarder,
} from "../../src";
import { Provider } from "ethers/providers";
import { Wallet } from "ethers/wallet";
import {
  ChainID,
  ReplayProtectionType,
} from "../../src/ts/forwarders/forwarderFactory";
import { flipBit } from "../utils/bitflip-utils";

const expect = chai.expect;
chai.use(solidity);

let dummyAccount: RelayHub;
type relayHubFunctions = typeof dummyAccount.functions;

async function createRelayHub(
  provider: Provider,
  [admin, owner, sender]: Wallet[]
) {
  const relayHubFactory = new RelayHubFactory(admin);
  const relayHubCreationTx = relayHubFactory.getDeployTransaction();
  const relayHubCreation = await admin.sendTransaction(relayHubCreationTx);
  const result = await relayHubCreation.wait(1);
  const relayHub = relayHubFactory.attach(result.contractAddress!);

  const nonceStoreMock = new Doppelganger(IReplayProtectionJson.interface);
  await nonceStoreMock.deploy(admin);
  await nonceStoreMock.update.returns(true);
  await nonceStoreMock.updateFor.returns(true);

  const bitFlipNonceStoreFactory = new BitFlipNonceStoreFactory(admin);
  const bitFlipNonceStore = await bitFlipNonceStoreFactory.deploy();

  const msgSenderFactory = new MsgSenderExampleFactory(admin);
  const msgSenderCon = await msgSenderFactory.deploy(result.contractAddress!);
  const forwarderFactory = new RelayHubForwarderFactory();

  return {
    provider,
    relayHub,
    admin,
    owner,
    sender,
    msgSenderCon,
    nonceStoreMock,
    bitFlipNonceStore,
    forwarderFactory,
  };
}

describe("RelayHub Contract", () => {
  fnIt<relayHubFunctions>(
    (a) => a.forward,
    "for msgSender emits expected signer address",
    async () => {
      const { relayHub, owner, sender, msgSenderCon } = await loadFixture(
        createRelayHub
      );
      const msgSenderCall = msgSenderCon.interface.functions.test.encode([]);
      const forwarder = new RelayHubForwarder(
        ChainID.MAINNET,
        owner,
        relayHub.address,
        new MultiNonceReplayProtection(30, owner, relayHub.address)
      );
      const params = await forwarder.signMetaTransaction({
        to: msgSenderCon.address,
        data: msgSenderCall,
      });

      const tx = relayHub
        .connect(sender)
        .forward(
          params.target,
          params.data,
          params.replayProtection,
          params.replayProtectionAuthority,
          params.signer,
          params.signature
        );

      await expect(tx)
        .to.emit(msgSenderCon, msgSenderCon.interface.events.WhoIsSender.name)
        .withArgs(owner.address);
    }
  );

  fnIt<relayHubFunctions>(
    (a) => a.forward,
    "sending two transactions should work with no replay protection conflicts",
    async () => {
      const { relayHub, owner, sender, msgSenderCon } = await loadFixture(
        createRelayHub
      );
      const msgSenderCall = msgSenderCon.interface.functions.test.encode([]);
      const forwarder = new RelayHubForwarder(
        ChainID.MAINNET,
        owner,
        relayHub.address,
        new MultiNonceReplayProtection(30, owner, relayHub.address)
      );

      // Send off first transaction!
      let params = await forwarder.signMetaTransaction({
        to: msgSenderCon.address,
        data: msgSenderCall,
      });

      let tx = relayHub
        .connect(sender)
        .forward(
          params.target,
          params.data,
          params.replayProtection,
          params.replayProtectionAuthority,
          params.signer,
          params.signature
        );

      await expect(tx)
        .to.emit(msgSenderCon, msgSenderCon.interface.events.WhoIsSender.name)
        .withArgs(owner.address);

      // Send off second transaction!
      params = await forwarder.signMetaTransaction({
        to: msgSenderCon.address,
        data: msgSenderCall,
      });

      tx = relayHub
        .connect(sender)
        .forward(
          params.target,
          params.data,
          params.replayProtection,
          params.replayProtectionAuthority,
          params.signer,
          params.signature
        );

      await expect(tx)
        .to.emit(msgSenderCon, msgSenderCon.interface.events.WhoIsSender.name)
        .withArgs(owner.address);
    }
  );

  fnIt<relayHubFunctions>(
    (a) => a.forward,
    "receives bad replay protection authority address and fails",
    async () => {
      const {
        relayHub,
        owner,
        sender,
        msgSenderCon,
        forwarderFactory,
      } = await loadFixture(createRelayHub);
      const msgSenderCall = msgSenderCon.interface.functions.test.encode([]);
      const value = new BigNumber("0");
      const encodedReplayProtection = "0x";
      const replayProtectionAuthority =
        "0x0000000000000000000000000000000000000002";
      const encodedCallData = defaultAbiCoder.encode(
        ["address", "uint", "bytes"],
        [msgSenderCon.address, value, msgSenderCall]
      );

      // We expect encoded call data to include target contract address, the value, and the callData.
      // Message signed: H(encodedCallData, encodedReplayProtection, replay protection authority, relay contract address, chainid);
      const forwarder = await forwarderFactory.createNew(
        ChainID.MAINNET,
        ReplayProtectionType.MULTINONCE,
        owner
      );

      // @ts-ignore:
      const encodedData = forwarder.encodeMetaTransactionToSign(
        encodedCallData,
        encodedReplayProtection,
        replayProtectionAuthority,
        relayHub.address
      );

      const signature = await owner.signMessage(
        arrayify(keccak256(encodedData))
      );

      const tx = relayHub
        .connect(sender)
        .forward(
          msgSenderCon.address,
          encodedCallData,
          encodedReplayProtection,
          replayProtectionAuthority,
          owner.address,
          signature
        );

      // An empty revert message, since the function doesn't exist on that contract address
      await expect(tx).to.be.reverted;
    }
  );

  fnIt<relayHubFunctions>(
    (a) => a.forward,
    "replay protection too far in future and fails",
    async () => {
      const {
        relayHub,
        owner,
        sender,
        msgSenderCon,
        forwarderFactory,
      } = await loadFixture(createRelayHub);
      const msgSenderCall = msgSenderCon.interface.functions.test.encode([]);
      const value = new BigNumber("0");
      const encodedReplayProtection = defaultAbiCoder.encode(
        ["uint", "uint"],
        [0, 123]
      );
      const encodedCallData = defaultAbiCoder.encode(
        ["address", "uint", "bytes"],
        [msgSenderCon.address, value, msgSenderCall]
      );

      // We expect encoded call data to include target contract address, the value, and the callData.
      // Message signed: H(encodedCallData, encodedReplayProtection, replay protection authority, relay contract address, chainid);
      const forwarder = await forwarderFactory.createNew(
        ChainID.MAINNET,
        ReplayProtectionType.MULTINONCE,
        owner
      );
      // @ts-ignore:
      const encodedData = forwarder.encodeMetaTransactionToSign(
        encodedCallData,
        encodedReplayProtection,
        "0x0000000000000000000000000000000000000000",
        relayHub.address
      );

      const signature = await owner.signMessage(
        arrayify(keccak256(encodedData))
      );

      const tx = relayHub
        .connect(sender)
        .forward(
          msgSenderCon.address,
          encodedCallData,
          encodedReplayProtection,
          "0x0000000000000000000000000000000000000000",
          owner.address,
          signature
        );

      // An empty revert message, since the function doesn't exist on that contract address
      await expect(tx).to.be.revertedWith(
        "Multinonce replay protection failed"
      );
    }
  );

  fnIt<relayHubFunctions>(
    (a) => a.forward,
    "target contract function reverts and we can detect it in the relay hub.",
    async () => {
      const { relayHub, owner, sender, msgSenderCon } = await loadFixture(
        createRelayHub
      );
      const msgSenderCall = msgSenderCon.interface.functions.willRevert.encode(
        []
      );
      const forwarder = new RelayHubForwarder(
        ChainID.MAINNET,
        owner,
        relayHub.address,
        new MultiNonceReplayProtection(30, owner, relayHub.address)
      );

      // Send off first transaction!
      let params = await forwarder.signMetaTransaction({
        to: msgSenderCon.address,
        data: msgSenderCall,
      });

      let tx = relayHub
        .connect(sender)
        .forward(
          params.target,
          params.data,
          params.replayProtection,
          params.replayProtectionAuthority,
          params.signer,
          params.signature
        );
      await expect(tx).to.be.revertedWith("Forwarding call failed.");
    }
  );

  fnIt<relayHubFunctions>(
    (a) => a.forward,
    "empty signature will emit a pseudo-random signer",
    async () => {
      const {
        relayHub,
        owner,
        sender,
        msgSenderCon,
        forwarderFactory,
      } = await loadFixture(createRelayHub);
      const msgSenderCall = msgSenderCon.interface.functions.test.encode([]);

      const forwarder = await forwarderFactory.createNew(
        ChainID.MAINNET,
        ReplayProtectionType.MULTINONCE,
        owner
      );

      // Replay protection is always reset due to fixture. So it should be [0.0].
      const params = await forwarder.signMetaTransaction({
        to: msgSenderCon.address,
        data: msgSenderCall,
      });

      const tx = relayHub
        .connect(sender)
        .forward(
          params.target,
          params.data,
          params.replayProtection,
          params.replayProtectionAuthority,
          params.signer,
          "0x0000000000000000000000000000000000000000"
        );

      await expect(tx).to.revertedWith(
        "Signer did not sign this meta-transaction."
      );
    }
  );

  fnIt<relayHubFunctions>(
    (a) => a.forward,
    "to use an external replay protection authority successfully",
    async () => {
      const {
        relayHub,
        owner,
        sender,
        msgSenderCon,
        bitFlipNonceStore,
        forwarderFactory,
      } = await loadFixture(createRelayHub);
      const msgSenderCall = msgSenderCon.interface.functions.test.encode([]);

      // Since we are using bitflip. It'll flip 123 with an empty bitmap. It'll flip lots of bits, but it should work.
      const encodedReplayProtection = defaultAbiCoder.encode(
        ["uint", "uint"],
        [0, 123]
      );
      const encodedCallData = defaultAbiCoder.encode(
        ["address", "bytes"],
        [msgSenderCon.address, msgSenderCall]
      );

      const forwarder = await forwarderFactory.createNew(
        ChainID.MAINNET,
        ReplayProtectionType.MULTINONCE,
        owner
      );

      // @ts-ignore:
      const encodedData = forwarder.encodeMetaTransactionToSign(
        encodedCallData,
        encodedReplayProtection,
        bitFlipNonceStore.address,
        relayHub.address
      );
      const signature = await owner.signMessage(
        arrayify(keccak256(encodedData))
      );

      const tx = relayHub
        .connect(sender)
        .forward(
          msgSenderCon.address,
          msgSenderCall,
          encodedReplayProtection,
          bitFlipNonceStore.address,
          owner.address,
          signature
        );

      await expect(tx).to.emit(
        msgSenderCon,
        msgSenderCon.interface.events.WhoIsSender.name
      );
    }
  );

  fnIt<relayHubFunctions>(
    (a) => a.forward,
    "to use an external replay protection authority is successfully, but its reuse fails due to replay protection.",
    async () => {
      const {
        relayHub,
        owner,
        sender,
        msgSenderCon,
        bitFlipNonceStore,
        forwarderFactory,
      } = await loadFixture(createRelayHub);
      const msgSenderCall = msgSenderCon.interface.functions.test.encode([]);

      // Since we are using bitflip. It'll flip 123 with an empty bitmap. It'll flip lots of bits, but it should work.
      const encodedReplayProtection = defaultAbiCoder.encode(
        ["uint", "uint"],
        [0, 123]
      );
      const encodedCallData = defaultAbiCoder.encode(
        ["address", "bytes"],
        [msgSenderCon.address, msgSenderCall]
      );

      const forwarder = await forwarderFactory.createNew(
        ChainID.MAINNET,
        ReplayProtectionType.MULTINONCE,
        owner
      );

      // @ts-ignore:
      const encodedData = forwarder.encodeMetaTransactionToSign(
        encodedCallData,
        encodedReplayProtection,
        bitFlipNonceStore.address,
        relayHub.address
      );
      const signature = await owner.signMessage(
        arrayify(keccak256(encodedData))
      );

      const tx = relayHub
        .connect(sender)
        .forward(
          msgSenderCon.address,
          msgSenderCall,
          encodedReplayProtection,
          bitFlipNonceStore.address,
          owner.address,
          signature
        );

      await expect(tx).to.emit(
        msgSenderCon,
        msgSenderCon.interface.events.WhoIsSender.name
      );

      const tx2 = relayHub
        .connect(sender)
        .forward(
          msgSenderCon.address,
          msgSenderCall,
          encodedReplayProtection,
          bitFlipNonceStore.address,
          owner.address,
          signature
        );

      await expect(tx2).to.be.revertedWith("Nonce already used.");
    }
  );

  fnIt<relayHubFunctions>(
    (a) => a.forward,
    "for msgSender emits expected signer address twice with inbuilt bitflip protection",
    async () => {
      const { relayHub, owner, sender, msgSenderCon } = await loadFixture(
        createRelayHub
      );
      const msgSenderCall = msgSenderCon.interface.functions.test.encode([]);
      const forwarder = new RelayHubForwarder(
        ChainID.MAINNET,
        owner,
        relayHub.address,
        new BitFlipReplayProtection(owner, relayHub.address)
      );
      const params1 = await forwarder.signMetaTransaction({
        to: msgSenderCon.address,
        data: msgSenderCall,
      });

      const tx1 = relayHub
        .connect(sender)
        .forward(
          params1.target,
          params1.data,
          params1.replayProtection,
          params1.replayProtectionAuthority,
          params1.signer,
          params1.signature
        );

      await expect(tx1)
        .to.emit(msgSenderCon, msgSenderCon.interface.events.WhoIsSender.name)
        .withArgs(owner.address);

      const params2 = await forwarder.signMetaTransaction({
        to: msgSenderCon.address,
        data: msgSenderCall,
      });

      const tx2 = relayHub
        .connect(sender)
        .forward(
          params2.target,
          params2.data,
          params2.replayProtection,
          params2.replayProtectionAuthority,
          params2.signer,
          params2.signature
        );

      await expect(tx2)
        .to.emit(msgSenderCon, msgSenderCon.interface.events.WhoIsSender.name)
        .withArgs(owner.address);
    }
  );
});
