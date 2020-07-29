import "mocha";
import * as chai from "chai";
import { solidity, loadFixture } from "ethereum-waffle";
import { BigNumber, defaultAbiCoder, keccak256, arrayify } from "ethers/utils";
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
  RelayHubCallData,
  RevertableRelayHubCallData,
} from "../../src";
import { Provider } from "ethers/providers";
import { Wallet } from "ethers/wallet";
import { AddressZero } from "ethers/constants";

import {
  ChainID,
  ReplayProtectionType,
} from "../../src/ts/forwarders/forwarderFactory";
import { CallType } from "../../src/ts/forwarders/forwarder";
import { ReplayProtectionAuthority } from "../../src/ts/replayProtection/replayProtectionAuthority";

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
    "verify the multinonce and bitflip values are correct",
    async () => {
      const { relayHub } = await loadFixture(createRelayHub);

      const relayhub_multinonce = await relayHub.multiNonceAddress();
      const relayhub_bitflip = await relayHub.bitFlipAddress();
      expect(relayhub_multinonce).to.eq(AddressZero);
      expect(relayhub_bitflip).to.eq(
        "0x0000000000000000000000000000000000000001"
      );
    }
  );

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

      const metaTx = await forwarder.signMetaTransaction({
        to: msgSenderCon.address,
        data: msgSenderCall,
      });
      const params = forwarder.decodeTx(metaTx.data);
      const tx = relayHub
        .connect(sender)
        .forward(
          { to: params._metaTx.to, data: params._metaTx.data },
          params._replayProtection,
          params._replayProtectionAuthority,
          params._signature
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
      const metaTx = await forwarder.signMetaTransaction({
        to: msgSenderCon.address,
        data: msgSenderCall,
      });
      const params = forwarder.decodeTx(metaTx.data);

      const tx = relayHub
        .connect(sender)
        .forward(
          { to: params._metaTx.to, data: params._metaTx.data },
          params._replayProtection,
          params._replayProtectionAuthority,
          params._signature
        );

      await expect(tx)
        .to.emit(msgSenderCon, msgSenderCon.interface.events.WhoIsSender.name)
        .withArgs(owner.address);

      // Send off second transaction!

      const metaTx2 = await forwarder.signMetaTransaction({
        to: msgSenderCon.address,
        data: msgSenderCall,
      });
      const params2 = forwarder.decodeTx(metaTx2.data);

      const tx2 = relayHub
        .connect(sender)
        .forward(
          { to: params2._metaTx.to, data: params2._metaTx.data },
          params2._replayProtection,
          params2._replayProtectionAuthority,
          params2._signature
        );

      await expect(tx2)
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

      let minimalTx = await forwarder.signMetaTransaction({
        to: msgSenderCon.address,
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

      let minimalTx = await forwarder.signMetaTransaction({
        to: msgSenderCon.address,
        data: revertCallData,
      });

      await sender.sendTransaction({ to: minimalTx.to, data: minimalTx.data });

      for (let i = 0; i < 5; i++) {
        // Send off first transaction!
        const metaTx = await forwarder.signMetaTransaction({
          to: msgSenderCon.address,
          data: msgSenderCall,
        });
        const params = forwarder.decodeTx(metaTx.data);

        const tx = relayHub
          .connect(sender)
          .forward(
            { to: params._metaTx.to, data: params._metaTx.data },
            params._replayProtection,
            params._replayProtectionAuthority,
            params._signature
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
      const callData: RelayHubCallData = {
        to: msgSenderCon.address,
        data: msgSenderCall,
      };

      // We expect encoded call data to include target contract address, the value, and the callData.
      // Message signed: H(encodedCallData, encodedReplayProtection, replay protection authority, relay contract address, chainid);
      const forwarder = await forwarderFactory.createNew(
        ChainID.MAINNET,
        ReplayProtectionType.MULTINONCE,
        owner
      );

      const signature = await encodeAndsign(
        callData,
        encodedReplayProtection,
        AddressZero,
        forwarder.address,
        owner
      );

      const tx = relayHub
        .connect(sender)
        .forward(
          { to: msgSenderCon.address, data: callData.data },
          encodedReplayProtection,
          replayProtectionAuthority,
          signature
        );

      // An empty revert message, since the function doesn't exist on that contract address
      await expect(tx).to.be.reverted;
    }
  );

  const encodeAndsign = async (
    callData: RelayHubCallData,
    replayProtection: string,
    replayProtectionAuthority: string,
    forwarderAddress: string,
    owner: Wallet
  ) => {
    const encodedData = defaultAbiCoder.encode(
      ["uint", "address", "bytes"],
      [CallType.CALL, callData.to, callData.data]
    );

    const encodedMetaTx = defaultAbiCoder.encode(
      ["bytes", "bytes", "address", "address", "uint"],
      [
        encodedData,
        replayProtection,
        replayProtectionAuthority,
        forwarderAddress,
        ChainID.MAINNET,
      ]
    );

    return await owner.signMessage(arrayify(keccak256(encodedMetaTx)));
  };

  const encodeAndSignBatch = async (
    callData: Required<RevertableRelayHubCallData>[],
    replayProtection: string,
    replayProtectionAuthority: string,
    forwarderAddress: string,
    owner: Wallet
  ) => {
    const encodedData = defaultAbiCoder.encode(
      ["uint", "tuple(address to, bytes data, bool revertOnFail)[]"],
      [CallType.BATCH, callData]
    );

    const encodedMetaTx = defaultAbiCoder.encode(
      ["bytes", "bytes", "address", "address", "uint"],
      [
        encodedData,
        replayProtection,
        replayProtectionAuthority,
        forwarderAddress,
        ChainID.MAINNET,
      ]
    );

    return await owner.signMessage(arrayify(keccak256(encodedMetaTx)));
  };

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

      const callData: RelayHubCallData = {
        to: msgSenderCon.address,
        data: msgSenderCall,
      };

      const forwarder = await forwarderFactory.createNew(
        ChainID.MAINNET,
        ReplayProtectionType.MULTINONCE,
        owner
      );
      // We expect encoded call data to include target contract address, the value, and the callData.
      // Message signed: H(encodedCallData, encodedReplayProtection, replay protection authority, relay contract address, chainid);
      const signature = await encodeAndsign(
        callData,
        encodedReplayProtection,
        AddressZero,
        forwarder.address,
        owner
      );

      const tx = relayHub
        .connect(sender)
        .forward(
          { to: msgSenderCon.address, data: callData.data },
          encodedReplayProtection,
          "0x0000000000000000000000000000000000000000",
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
      const metatx = await forwarder.signMetaTransaction({
        to: msgSenderCon.address,
        data: msgSenderCall,
      });
      const params = forwarder.decodeTx(metatx.data);

      const tx = relayHub
        .connect(sender)
        .forward(
          { to: params._metaTx.to, data: params._metaTx.data },
          params._replayProtection,
          params._replayProtectionAuthority,
          params._signature
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
      const metaTx = await forwarder.signMetaTransaction({
        to: msgSenderCon.address,
        data: msgSenderCall,
      });
      const params = forwarder.decodeTx(metaTx.data);
      const tx = relayHub
        .connect(sender)
        .forward(
          { to: params._metaTx.to, data: params._metaTx.data },
          params._replayProtection,
          params._replayProtectionAuthority,
          "0x3d046631b28da61f863882122e10dd9b3a7343b180b987834edfe6e06bbec8ac2fa35ab8977318a1c8a4401a98f33b476f02e175003d820bbe21268d803579d01b"
        );

      await expect(tx)
        .to.emit(msgSenderCon, msgSenderCon.interface.events.WhoIsSender.name)
        .withArgs("0x8EB9A18610A62B20A1C2598e02680635A0fC0890");
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
      const callData: RelayHubCallData = {
        to: msgSenderCon.address,
        data: msgSenderCall,
      };

      const forwarder = await forwarderFactory.createNew(
        ChainID.MAINNET,
        ReplayProtectionType.MULTINONCE,
        owner
      );
      const signature = await encodeAndsign(
        callData,
        encodedReplayProtection,
        AddressZero,
        forwarder.address,
        owner
      );

      const tx = relayHub
        .connect(sender)
        .forward(
          { to: msgSenderCon.address, data: callData.data },
          encodedReplayProtection,
          bitFlipNonceStore.address,
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

      const callData: RelayHubCallData = {
        to: msgSenderCon.address,
        data: msgSenderCall,
      };

      // No replay protection authority used. We are using
      // an external authority and will craft it manually.
      const forwarder = new RelayHubForwarder(
        ChainID.MAINNET,
        owner,
        RELAY_HUB_ADDRESS,
        new BitFlipReplayProtection(owner, RELAY_HUB_ADDRESS) // NOT USED IN TEST
      );

      const signature = await encodeAndsign(
        callData,
        encodedReplayProtection,
        AddressZero,
        forwarder.address,
        owner
      );

      const tx = relayHub
        .connect(sender)
        .forward(
          { to: msgSenderCon.address, data: msgSenderCall },
          encodedReplayProtection,
          bitFlipNonceStore.address,
          signature
        );

      await expect(tx).to.emit(
        msgSenderCon,
        msgSenderCon.interface.events.WhoIsSender.name
      );

      const tx2 = relayHub
        .connect(sender)
        .forward(
          { to: msgSenderCon.address, data: msgSenderCall },
          encodedReplayProtection,
          bitFlipNonceStore.address,
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

      const metaTx1 = await forwarder.signMetaTransaction({
        to: msgSenderCon.address,
        data: msgSenderCall,
      });
      const params1 = forwarder.decodeTx(metaTx1.data);

      const tx1 = relayHub
        .connect(sender)
        .forward(
          { to: params1._metaTx.to, data: params1._metaTx.data },
          params1._replayProtection,
          params1._replayProtectionAuthority,
          params1._signature
        );

      await expect(tx1)
        .to.emit(msgSenderCon, msgSenderCon.interface.events.WhoIsSender.name)
        .withArgs(owner.address);

      const metaTx2 = await forwarder.signMetaTransaction({
        to: msgSenderCon.address,
        data: msgSenderCall,
      });
      const params2 = forwarder.decodeTx(metaTx2.data);

      const tx2 = relayHub
        .connect(sender)
        .forward(
          { to: params2._metaTx.to, data: params2._metaTx.data },
          params2._replayProtection,
          params2._replayProtectionAuthority,
          params2._signature
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

      const msgSenderCall = msgSenderCon.interface.functions.test.encode([]);

      const metaTxList = [
        { to: msgSenderCon.address, data: msgSenderCall, revertOnFail: false },
      ];
      const replayProtection = defaultAbiCoder.encode(["uint", "uint"], [0, 0]);
      const signature = await encodeAndSignBatch(
        metaTxList,
        replayProtection,
        AddressZero,
        forwarder.address,
        admin
      );

      const encodedBatch = relayHub.interface.functions.batch.encode([
        metaTxList,
        replayProtection,
        AddressZero,
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
        { to: msgSenderCon.address, data: callData, revertOnFail: false },
        { to: echoCon.address, data: echoData, revertOnFail: false },
      ];
      const replayProtection = defaultAbiCoder.encode(["uint", "uint"], [0, 0]);

      const signature = await encodeAndSignBatch(
        metaTxList,
        replayProtection,
        AddressZero,
        forwarder.address,
        admin
      );

      const encodedBatch = relayHub.interface.functions.batch.encode([
        metaTxList,
        replayProtection,
        AddressZero,
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
        { to: msgSenderCon.address, data: callData, revertOnFail: false },
        { to: echoCon.address, data: echoData, revertOnFail: false },
      ];
      const replayProtection = defaultAbiCoder.encode(["uint", "uint"], [0, 0]);

      const signature = await encodeAndSignBatch(
        metaTxList,
        replayProtection,
        AddressZero,
        forwarder.address,
        admin
      );

      const encodedBatch = relayHub.interface.functions.batch.encode([
        metaTxList,
        replayProtection,
        AddressZero,
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
        { to: msgSenderCon.address, data: callData, revertOnFail: true },
        { to: echoCon.address, data: echoData, revertOnFail: false },
      ];
      const replayProtection = defaultAbiCoder.encode(["uint", "uint"], [0, 0]);
      const signature = await encodeAndSignBatch(
        metaTxList,
        replayProtection,
        AddressZero,
        forwarder.address,
        admin
      );

      const encodedBatch = relayHub.interface.functions.batch.encode([
        metaTxList,
        replayProtection,
        AddressZero,
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
