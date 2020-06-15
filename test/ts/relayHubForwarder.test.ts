import "mocha";
import * as chai from "chai";
import { solidity, loadFixture } from "ethereum-waffle";
import { BigNumber, BigNumberish, defaultAbiCoder } from "ethers/utils";
import {
  RelayHubFactory,
  MsgSenderExampleFactory,
  ProxyAccountDeployerFactory,
  RelayHubForwarderFactory,
  MultiNonceReplayProtection,
  BitFlipReplayProtection,
  deployMetaTxContracts,
  RELAY_HUB_ADDRESS,
  EchoFactory,
} from "../../src";

import { Provider } from "ethers/providers";
import { Wallet } from "ethers/wallet";
import {
  ChainID,
  ReplayProtectionType,
} from "../../src/ts/forwarders/forwarderFactory";
import { Forwarder } from "../../src/ts/forwarders/forwarder";
import { RelayHubForwarder } from "../../src/ts/forwarders/relayHubForwarder";
import { flipBit } from "../utils/test-utils";
import { ProxyAccountCallData } from "../../src/ts/forwarders/proxyAccountFowarder";

const expect = chai.expect;
chai.use(solidity);

async function createHubs(provider: Provider, [admin, user1, user2]: Wallet[]) {
  const {
    relayHubAddress,
    proxyAccountDeployerAddress,
  } = await deployMetaTxContracts(admin);

  const relayHub = new RelayHubFactory(admin).attach(relayHubAddress);
  const proxyDeployer = new ProxyAccountDeployerFactory(admin).attach(
    proxyAccountDeployerAddress
  );
  const msgSenderExample = await new MsgSenderExampleFactory(admin).deploy(
    relayHub.address
  );

  const echoCon = await new EchoFactory(admin).deploy();

  const forwarderFactory = new RelayHubForwarderFactory();
  return {
    relayHub,
    proxyDeployer,
    admin,
    user1,
    user2,
    msgSenderExample,
    forwarderFactory,
    echoCon,
  };
}

const checkMetaTx = (
  metaTx: { to: string; data: string; value?: BigNumberish },
  forwarder: RelayHubForwarder,
  nonce1: string,
  nonce2: string,
  toAddress: string,
  callData: string,
  replayProtectionAuthority: string
) => {
  const forwardParams = forwarder.decodeTx(metaTx.data);

  const decodedReplayProtection = defaultAbiCoder.decode(
    ["uint", "uint"],
    forwardParams._replayProtection
  );

  expect(forwardParams._metaTx.data, "Calldata").to.eq(callData);
  expect(metaTx.to, "Relay hub address").to.eq(forwarder.address);
  expect(decodedReplayProtection[0], "Nonce1").to.eq(new BigNumber(nonce1));
  expect(decodedReplayProtection[1], "Nonce2").to.eq(new BigNumber(nonce2));
  expect(
    forwardParams._replayProtectionAuthority,
    "Nonce replay protection"
  ).to.eq(replayProtectionAuthority);
  expect(forwardParams._metaTx.to, "Target contract").to.eq(toAddress);
  expect(metaTx.value, "Value").to.be.undefined;
};

describe("RelayHub Forwarder", () => {
  it("Sign a meta-transaction with multinonce and check the forward params are correct", async () => {
    const { relayHub, admin, msgSenderExample } = await loadFixture(createHubs);

    const callData = msgSenderExample.interface.functions.willRevert.encode([]);

    const replay = new MultiNonceReplayProtection(30, admin, relayHub.address)
    const forwarder = new RelayHubForwarder(
      ChainID.MAINNET,
      admin,
      relayHub.address,
      replay
    );

    const metaTx = await forwarder.signMetaTransaction({
      to: msgSenderExample.address,
      data: callData,
    });

    checkMetaTx(
      metaTx,
      forwarder,
      "0",
      "0",
      msgSenderExample.address,
      callData,
      replay.address
    );
  }).timeout(50000);

  it("Sign a meta-transaction with bitflip and check the forward params are correct", async () => {
    const { relayHub, admin, msgSenderExample } = await loadFixture(createHubs);

    const callData = msgSenderExample.interface.functions.willRevert.encode([]);

    const bitlip = new BitFlipReplayProtection(admin, relayHub.address);
    const forwarder = new RelayHubForwarder(
      ChainID.MAINNET,
      admin,
      relayHub.address,
      bitlip
    );

    const metaTx = await forwarder.signMetaTransaction({
      to: msgSenderExample.address,
      data: callData,
    });

    const bitFlipped = flipBit(new BigNumber("0"), new BigNumber("0"));
    checkMetaTx(
      metaTx,
      forwarder,
      bitlip.index.toString(),
      bitFlipped.toString(),
      msgSenderExample.address,
      callData,
      "0x0000000000000000000000000000000000000001"
    );
  }).timeout(50000);

  it("Encode a signed meta-transaction", async () => {
    const { msgSenderExample, relayHub, user1 } = await loadFixture(createHubs);

    const noQueues = 10;
    const proxyForwarder = new RelayHubForwarder(
      ChainID.MAINNET,
      user1,
      relayHub.address,
      new MultiNonceReplayProtection(noQueues, user1, relayHub.address)
    );

    const callData = msgSenderExample.interface.functions.test.encode([]);
    const minimalTx = await proxyForwarder.signMetaTransaction({
      to: msgSenderExample.address,
      data: callData,
    });

    const tx = user1.sendTransaction({
      to: minimalTx.to,
      data: minimalTx.data,
    });

    await expect(tx)
      .to.emit(
        msgSenderExample,
        msgSenderExample.interface.events.WhoIsSender.name
      )
      .withArgs(user1.address);
  }).timeout(50000);

  it("Sign multiple meta-transactions with bitflip", async () => {
    const { msgSenderExample, relayHub, user2 } = await loadFixture(createHubs);

    const bitflip = new BitFlipReplayProtection(user2, relayHub.address)
    const proxyForwarder = new RelayHubForwarder(
      ChainID.MAINNET,
      user2,
      relayHub.address,
      bitflip
    );

    const callData = msgSenderExample.interface.functions.willRevert.encode([]);

    for (let j = 0; j < 10; j++) {
      for (let i = 0; i < 256; i++) {
        const metaTx = await proxyForwarder.signMetaTransaction({
          to: msgSenderExample.address,
          data: callData,
        });

        const bitFlipped = flipBit(new BigNumber("0"), new BigNumber(i));
        checkMetaTx(
          metaTx,
          proxyForwarder,
          bitflip.index.toString(),
          bitFlipped.toString(),
          msgSenderExample.address,
          callData,
          "0x0000000000000000000000000000000000000001"
        );
      }
    }
  }).timeout(500000);

  it("Send one transaction via the batch. It should succeed.", async () => {
    const { msgSenderExample, admin } = await loadFixture(createHubs);

    const forwarder = new RelayHubForwarder(
      ChainID.MAINNET,
      admin,
      RELAY_HUB_ADDRESS,
      new BitFlipReplayProtection(admin, RELAY_HUB_ADDRESS)
    );

    const callData = msgSenderExample.interface.functions.test.encode([]);

    const metaTxList = [
      { to: msgSenderExample.address, data: callData, revertOnFail: false },
    ];

    const minimaltx = await forwarder.signMetaTransaction(metaTxList);

    const tx = admin.sendTransaction({
      to: minimaltx.to,
      data: minimaltx.data,
    });

    await expect(tx)
      .to.emit(
        msgSenderExample,
        msgSenderExample.interface.events.WhoIsSender.name
      )
      .withArgs(admin.address);
  }).timeout(500000);

  it("Send one transaction via the batch without defining revertOnFail. It should succeed.", async () => {
    const { msgSenderExample, admin } = await loadFixture(createHubs);

    const forwarder = new RelayHubForwarder(
      ChainID.MAINNET,
      admin,
      RELAY_HUB_ADDRESS,
      new BitFlipReplayProtection(admin, RELAY_HUB_ADDRESS)
    );

    const callData = msgSenderExample.interface.functions.test.encode([]);

    const metaTxList = [
      { to: msgSenderExample.address, data: callData, revertOnFail: false },
    ];

    const minimaltx = await forwarder.signMetaTransaction(metaTxList);

    const tx = admin.sendTransaction({
      to: minimaltx.to,
      data: minimaltx.data,
    });

    await expect(tx)
      .to.emit(
        msgSenderExample,
        msgSenderExample.interface.events.WhoIsSender.name
      )
      .withArgs(admin.address);
  }).timeout(500000);

  it("Send two transactions via the batch. It should succeed.", async () => {
    const { msgSenderExample, admin, echoCon } = await loadFixture(createHubs);

    const forwarder = new RelayHubForwarder(
      ChainID.MAINNET,
      admin,
      RELAY_HUB_ADDRESS,
      new BitFlipReplayProtection(admin, RELAY_HUB_ADDRESS)
    );

    const callData = msgSenderExample.interface.functions.test.encode([]);
    const echoData = echoCon.interface.functions.sendMessage.encode(["hello"]);

    const metaTxList = [
      { to: msgSenderExample.address, data: callData, revertOnFail: false },
      { to: echoCon.address, data: echoData, revertOnFail: false },
    ];

    const minimaltx = await forwarder.signMetaTransaction(metaTxList);

    const tx = admin.sendTransaction({
      to: minimaltx.to,
      data: minimaltx.data,
    });

    await expect(tx)
      .to.emit(
        msgSenderExample,
        msgSenderExample.interface.events.WhoIsSender.name
      )
      .withArgs(admin.address);

    const lastMessage = await echoCon.lastMessage();
    expect(lastMessage).to.eq("hello");
  }).timeout(500000);

  it("Send two transactions via the batch. First transaction reverts, but revert message is emitted.", async () => {
    const { msgSenderExample, admin, relayHub, echoCon } = await loadFixture(
      createHubs
    );

    const forwarder = new RelayHubForwarder(
      ChainID.MAINNET,
      admin,
      RELAY_HUB_ADDRESS,
      new BitFlipReplayProtection(admin, RELAY_HUB_ADDRESS)
    );

    const callData = msgSenderExample.interface.functions.willRevertLongMessage.encode(
      []
    );
    const echoData = echoCon.interface.functions.sendMessage.encode(["hello"]);

    const metaTxList = [
      { to: msgSenderExample.address, data: callData, revertOnFail: false },
      { to: echoCon.address, data: echoData, revertOnFail: false },
    ];

    const minimaltx = await forwarder.signMetaTransaction(metaTxList);

    const tx = admin.sendTransaction({
      to: minimaltx.to,
      data: minimaltx.data,
    });

    await expect(tx)
      .to.emit(relayHub, relayHub.interface.events.Revert.name)
      .withArgs(
        "This is a really long revert message to make sure we can catch it. There are no hidden quirks by solidity."
      );

    const lastMessage = await echoCon.lastMessage();
    expect(lastMessage).to.eq("hello");
  }).timeout(500000);

  it("Send two transactions via the batch. Second transaction reverts with revertOnFail=true. The Ethereum transaction fails.", async () => {
    const { msgSenderExample, admin, echoCon } = await loadFixture(createHubs);

    const forwarder = new RelayHubForwarder(
      ChainID.MAINNET,
      admin,
      RELAY_HUB_ADDRESS,
      new BitFlipReplayProtection(admin, RELAY_HUB_ADDRESS)
    );

    const callData = msgSenderExample.interface.functions.willRevertLongMessage.encode(
      []
    );
    const echoData = echoCon.interface.functions.sendMessage.encode(["hello"]);

    const metaTxList = [
      { to: echoCon.address, data: echoData, revertOnFail: false },
      { to: msgSenderExample.address, data: callData, revertOnFail: true },
    ];

    const minimaltx = await forwarder.signMetaTransaction(metaTxList);

    const tx = admin.sendTransaction({
      to: minimaltx.to,
      data: minimaltx.data,
    });

    await expect(tx).to.be.revertedWith("Meta-transaction failed");

    const lastMessage = await echoCon.lastMessage();
    expect(lastMessage).to.eq("");
  }).timeout(500000);
});
