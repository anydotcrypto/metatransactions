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
  RELAY_HUB_ADDRESS,
  deployMetaTxContracts,
  EchoFactory,
} from "../../src";
import { Provider } from "ethers/providers";
import { Wallet } from "ethers/wallet";
import { AddressZero } from "ethers/constants";

import {
  ChainID,
  ReplayProtectionType,
} from "../../src/ts/forwarders/forwarderFactory";
import { CallType } from "../../src/ts/forwarders/forwarder";

const expect = chai.expect;
chai.use(solidity);

let dummyAccount: RelayHub;
type relayHubFunctions = typeof dummyAccount.functions;

async function createRelayHub(
  provider: Provider,
  [admin, owner, sender]: Wallet[]
) {
  const { relayHubAddress } = await deployMetaTxContracts(admin);

  const relayHub = new RelayHubFactory(admin).attach(relayHubAddress);
  const nonceStoreMock = new Doppelganger(IReplayProtectionJson.interface);
  await nonceStoreMock.deploy(admin);
  await nonceStoreMock.update.returns(true);
  await nonceStoreMock.updateFor.returns(true);

  const bitFlipNonceStoreFactory = new BitFlipNonceStoreFactory(admin);
  const bitFlipNonceStore = await bitFlipNonceStoreFactory.deploy();

  const msgSenderFactory = new MsgSenderExampleFactory(admin);
  const msgSenderCon = await msgSenderFactory.deploy(relayHubAddress);
  const forwarderFactory = new RelayHubForwarderFactory();

  const echoCon = await new EchoFactory(admin).deploy();

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
    echoCon,
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

      // @ts-ignore
      const params = await forwarder.signMetaTransaction({
        target: msgSenderCon.address,
        data: msgSenderCall,
      });

      const tx = relayHub
        .connect(sender)
        .forward(
          { target: params.target, callData: params.data },
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
    "sending two transactions with no replay protection conflicts is successful ",
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
      // @ts-ignore
      let params = await forwarder.signMetaTransaction({
        target: msgSenderCon.address,
        data: msgSenderCall,
      });

      let tx = relayHub
        .connect(sender)
        .forward(
          { target: params.target, callData: params.data },
          params.replayProtection,
          params.replayProtectionAuthority,
          params.signer,
          params.signature
        );

      await expect(tx)
        .to.emit(msgSenderCon, msgSenderCon.interface.events.WhoIsSender.name)
        .withArgs(owner.address);

      // Send off second transaction!
      // @ts-ignore
      params = await forwarder.signMetaTransaction({
        target: msgSenderCon.address,
        data: msgSenderCall,
      });

      tx = relayHub
        .connect(sender)
        .forward(
          { target: params.target, callData: params.data },
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
    "forwarded transaction fails and we can extract the revert reason offchain.",
    async () => {
      const { relayHub, owner, sender, msgSenderCon } = await loadFixture(
        createRelayHub
      );
      const forwarder = new RelayHubForwarder(
        ChainID.MAINNET,
        owner,
        relayHub.address,
        new MultiNonceReplayProtection(30, owner, relayHub.address)
      );

      const revertCallData = msgSenderCon.interface.functions.willRevert.encode(
        []
      );

      let minimalTx = await forwarder.signAndEncodeMetaTransaction({
        target: msgSenderCon.address,
        data: revertCallData,
      });

      const tx = sender.sendTransaction({
        to: minimalTx.to,
        data: minimalTx.data,
      });

      await expect(tx)
        .to.emit(relayHub, relayHub.interface.events.Revert.name)
        .withArgs("Will always revert");
    }
  );

  fnIt<relayHubFunctions>(
    (a) => a.forward,
    "sending several transactions, but the first forward fails. All subsequent transactions should pass.",
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

      const revertCallData = msgSenderCon.interface.functions.willRevert.encode(
        []
      );

      let minimalTx = await forwarder.signAndEncodeMetaTransaction({
        target: msgSenderCon.address,
        data: revertCallData,
      });

      await sender.sendTransaction({ to: minimalTx.to, data: minimalTx.data });

      for (let i = 0; i < 5; i++) {
        // Send off first transaction!
        // @ts-ignore
        let params = await forwarder.signMetaTransaction({
          target: msgSenderCon.address,
          data: msgSenderCall,
        });

        let tx = relayHub
          .connect(sender)
          .forward(
            { target: params.target, callData: params.data },
            params.replayProtection,
            params.replayProtectionAuthority,
            params.signer,
            params.signature
          );

        await expect(tx)
          .to.emit(msgSenderCon, msgSenderCon.interface.events.WhoIsSender.name)
          .withArgs(owner.address);
      }
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
        replayProtectionAuthority
      );

      const signature = await owner.signMessage(
        arrayify(keccak256(encodedData))
      );

      const tx = relayHub
        .connect(sender)
        .forward(
          { target: msgSenderCon.address, callData: encodedCallData },
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
        "0x0000000000000000000000000000000000000000"
      );

      const signature = await owner.signMessage(
        arrayify(keccak256(encodedData))
      );

      const tx = relayHub
        .connect(sender)
        .forward(
          { target: msgSenderCon.address, callData: encodedCallData },
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
      // @ts-ignore
      let params = await forwarder.signMetaTransaction({
        target: msgSenderCon.address,
        data: msgSenderCall,
      });

      let tx = relayHub
        .connect(sender)
        .forward(
          { target: params.target, callData: params.data },
          params.replayProtection,
          params.replayProtectionAuthority,
          params.signer,
          params.signature
        );

      await expect(tx)
        .to.emit(relayHub, relayHub.interface.events.Revert.name)
        .withArgs("Will always revert");
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
      // @ts-ignore
      const params = await forwarder.signMetaTransaction({
        target: msgSenderCon.address,
        data: msgSenderCall,
      });

      const tx = relayHub
        .connect(sender)
        .forward(
          { target: params.target, callData: params.data },
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
        ["uint", "address", "bytes"],
        [CallType.CALL, msgSenderCon.address, msgSenderCall]
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
        bitFlipNonceStore.address
      );
      const signature = await owner.signMessage(
        arrayify(keccak256(encodedData))
      );

      const tx = relayHub
        .connect(sender)
        .forward(
          { target: msgSenderCon.address, callData: msgSenderCall },
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
      } = await loadFixture(createRelayHub);
      const msgSenderCall = msgSenderCon.interface.functions.test.encode([]);

      // Since we are using bitflip. It'll flip 123 with an empty bitmap. It'll flip lots of bits, but it should work.
      const encodedReplayProtection = defaultAbiCoder.encode(
        ["uint", "uint"],
        [0, 123]
      );
      const encodedCallData = defaultAbiCoder.encode(
        ["uint", "address", "bytes"],
        [CallType.CALL, msgSenderCon.address, msgSenderCall]
      );

      // No replay protection authority used. We are using
      // an external authority and will craft it manually.
      const forwarder = new RelayHubForwarder(
        ChainID.MAINNET,
        owner,
        RELAY_HUB_ADDRESS,
        new BitFlipReplayProtection(owner, RELAY_HUB_ADDRESS) // NOT USED IN TEST
      );

      // @ts-ignore:
      const encodedData = forwarder.encodeMetaTransactionToSign(
        encodedCallData,
        encodedReplayProtection,
        bitFlipNonceStore.address
      );
      const signature = await owner.signMessage(
        arrayify(keccak256(encodedData))
      );

      const tx = relayHub
        .connect(sender)
        .forward(
          { target: msgSenderCon.address, callData: msgSenderCall },
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
          { target: msgSenderCon.address, callData: msgSenderCall },
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
      // @ts-ignore
      const params1 = await forwarder.signMetaTransaction({
        target: msgSenderCon.address,
        data: msgSenderCall,
      });

      const tx1 = relayHub
        .connect(sender)
        .forward(
          { target: params1.target, callData: params1.data },
          params1.replayProtection,
          params1.replayProtectionAuthority,
          params1.signer,
          params1.signature
        );

      await expect(tx1)
        .to.emit(msgSenderCon, msgSenderCon.interface.events.WhoIsSender.name)
        .withArgs(owner.address);

      // @ts-ignore
      const params2 = await forwarder.signMetaTransaction({
        target: msgSenderCon.address,
        data: msgSenderCall,
      });

      const tx2 = relayHub
        .connect(sender)
        .forward(
          { target: params2.target, callData: params2.data },
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

  fnIt<relayHubFunctions>(
    (a) => a.batch,
    "Send one transaction via the batch. It should succeed.",
    async () => {
      const { msgSenderCon, admin, relayHub } = await loadFixture(
        createRelayHub
      );

      const forwarder = new RelayHubForwarder(
        ChainID.MAINNET,
        admin,
        RELAY_HUB_ADDRESS,
        new BitFlipReplayProtection(admin, RELAY_HUB_ADDRESS)
      );

      const callData = msgSenderCon.interface.functions.test.encode([]);

      const metaTxList = [
        { target: msgSenderCon.address, callData, revertOnFail: false },
      ];
      const replayProtection = defaultAbiCoder.encode(["uint", "uint"], [0, 0]);
      const encodedCallData = defaultAbiCoder.encode(
        ["uint", "tuple(address target, bytes callData, bool revertOnFail)[]"],
        [CallType.BATCH, metaTxList]
      );

      // @ts-ignore
      const encodedMetaTx = forwarder.encodeMetaTransactionToSign(
        encodedCallData,
        replayProtection,
        AddressZero
      );

      const signature = await admin.signMessage(
        arrayify(keccak256(encodedMetaTx))
      );

      const encodedBatch = relayHub.interface.functions.batch.encode([
        metaTxList,
        replayProtection,
        AddressZero,
        admin.address,
        signature,
      ]);

      const tx = admin.sendTransaction({
        to: forwarder.address,
        data: encodedBatch,
      });

      await expect(tx)
        .to.emit(msgSenderCon, msgSenderCon.interface.events.WhoIsSender.name)
        .withArgs(admin.address);
    }
  ).timeout(500000);

  fnIt<relayHubFunctions>(
    (a) => a.batch,
    "Send two transactions via the batch. It should succeed.",
    async () => {
      const { msgSenderCon, admin, relayHub, echoCon } = await loadFixture(
        createRelayHub
      );

      const forwarder = new RelayHubForwarder(
        ChainID.MAINNET,
        admin,
        RELAY_HUB_ADDRESS,
        new BitFlipReplayProtection(admin, RELAY_HUB_ADDRESS)
      );

      const echoData = echoCon.interface.functions.sendMessage.encode([
        "hello",
      ]);
      const callData = msgSenderCon.interface.functions.test.encode([]);

      const metaTxList = [
        { target: msgSenderCon.address, callData, revertOnFail: false },
        { target: echoCon.address, callData: echoData, revertOnFail: false },
      ];
      const replayProtection = defaultAbiCoder.encode(["uint", "uint"], [0, 0]);
      const encodedCallData = defaultAbiCoder.encode(
        ["uint", "tuple(address target, bytes callData, bool revertOnFail)[]"],
        [CallType.BATCH, metaTxList]
      );

      // @ts-ignore
      const encodedMetaTx = forwarder.encodeMetaTransactionToSign(
        encodedCallData,
        replayProtection,
        AddressZero
      );

      const signature = await admin.signMessage(
        arrayify(keccak256(encodedMetaTx))
      );

      const encodedBatch = relayHub.interface.functions.batch.encode([
        metaTxList,
        replayProtection,
        AddressZero,
        admin.address,
        signature,
      ]);

      const tx = admin.sendTransaction({
        to: forwarder.address,
        data: encodedBatch,
      });

      await expect(tx)
        .to.emit(msgSenderCon, msgSenderCon.interface.events.WhoIsSender.name)
        .withArgs(admin.address);

      const lastMessage = await echoCon.lastMessage();
      expect(lastMessage).to.eq("hello");
    }
  ).timeout(500000);

  fnIt<relayHubFunctions>(
    (a) => a.batch,
    "Send two transactions via the batch. First transaction reverts and the message is caught.",
    async () => {
      const { msgSenderCon, admin, relayHub, echoCon } = await loadFixture(
        createRelayHub
      );

      const forwarder = new RelayHubForwarder(
        ChainID.MAINNET,
        admin,
        RELAY_HUB_ADDRESS,
        new BitFlipReplayProtection(admin, RELAY_HUB_ADDRESS)
      );

      const echoData = echoCon.interface.functions.sendMessage.encode([
        "hello",
      ]);
      const callData = msgSenderCon.interface.functions.willRevert.encode([]);

      const metaTxList = [
        { target: msgSenderCon.address, callData, revertOnFail: false },
        { target: echoCon.address, callData: echoData, revertOnFail: false },
      ];
      const replayProtection = defaultAbiCoder.encode(["uint", "uint"], [0, 0]);
      const encodedCallData = defaultAbiCoder.encode(
        ["uint", "tuple(address target, bytes callData, bool revertOnFail)[]"],
        [CallType.BATCH, metaTxList]
      );

      // @ts-ignore
      const encodedMetaTx = forwarder.encodeMetaTransactionToSign(
        encodedCallData,
        replayProtection,
        AddressZero
      );

      const signature = await admin.signMessage(
        arrayify(keccak256(encodedMetaTx))
      );

      const encodedBatch = relayHub.interface.functions.batch.encode([
        metaTxList,
        replayProtection,
        AddressZero,
        admin.address,
        signature,
      ]);

      const tx = admin.sendTransaction({
        to: forwarder.address,
        data: encodedBatch,
      });

      await expect(tx)
        .to.emit(relayHub, relayHub.interface.events.Revert.name)
        .withArgs("Will always revert");

      const lastMessage = await echoCon.lastMessage();
      expect(lastMessage).to.eq("hello");
    }
  ).timeout(500000);

  fnIt<relayHubFunctions>(
    (a) => a.batch,
    "Send two transactions via the batch. First transaction reverts with revertOnFail=true. Full transaction reverts.",
    async () => {
      const { msgSenderCon, admin, relayHub, echoCon } = await loadFixture(
        createRelayHub
      );

      const forwarder = new RelayHubForwarder(
        ChainID.MAINNET,
        admin,
        RELAY_HUB_ADDRESS,
        new BitFlipReplayProtection(admin, RELAY_HUB_ADDRESS)
      );

      const echoData = echoCon.interface.functions.sendMessage.encode([
        "hello",
      ]);
      const callData = msgSenderCon.interface.functions.willRevert.encode([]);

      const metaTxList = [
        { target: msgSenderCon.address, callData, revertOnFail: true },
        { target: echoCon.address, callData: echoData, revertOnFail: false },
      ];
      const replayProtection = defaultAbiCoder.encode(["uint", "uint"], [0, 0]);
      const encodedCallData = defaultAbiCoder.encode(
        ["uint", "tuple(address target, bytes callData, bool revertOnFail)[]"],
        [CallType.BATCH, metaTxList]
      );

      // @ts-ignore
      const encodedMetaTx = forwarder.encodeMetaTransactionToSign(
        encodedCallData,
        replayProtection,
        AddressZero
      );

      const signature = await admin.signMessage(
        arrayify(keccak256(encodedMetaTx))
      );

      const encodedBatch = relayHub.interface.functions.batch.encode([
        metaTxList,
        replayProtection,
        AddressZero,
        admin.address,
        signature,
      ]);

      const tx = admin.sendTransaction({
        to: forwarder.address,
        data: encodedBatch,
      });

      await expect(tx).to.be.revertedWith("Meta-transaction failed");
    }
  ).timeout(500000);
});
