import "mocha";
import * as chai from "chai";
import { solidity, loadFixture } from "ethereum-waffle";
import { BigNumber, defaultAbiCoder } from "ethers/utils";
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

describe("RelayHub Forwarder", () => {
  it("Sign a meta-transaction with multinonce and check the forward params are correct", async () => {
    const { relayHub, admin, msgSenderExample } = await loadFixture(createHubs);

    const callData = msgSenderExample.interface.functions.willRevert.encode([]);

    const forwarder = new RelayHubForwarder(
      ChainID.MAINNET,
      admin,
      relayHub.address,
      new MultiNonceReplayProtection(30, admin, relayHub.address)
    );

    // @ts-ignore
    const forwardParams = await forwarder.signMetaTransaction({
      to: msgSenderExample.address,
      data: callData,
    });

    const decodedReplayProtection = defaultAbiCoder.decode(
      ["uint", "uint"],
      forwardParams.replayProtection
    );
    expect(forwardParams.chainId).to.eq(ChainID.MAINNET, "Mainnet chainID");
    expect(forwardParams.data).to.eq(callData, "Calldata");
    expect(forwardParams.to).to.eq(relayHub.address, "Relay hub address");
    expect(decodedReplayProtection[0]).to.eq(new BigNumber("0"), "Nonce1");
    expect(decodedReplayProtection[1]).to.eq(new BigNumber("0"), "Nonce2");
    expect(forwardParams.replayProtectionAuthority).to.eq(
      "0x0000000000000000000000000000000000000000",
      "Nonce replay protection"
    );
    expect(forwardParams.signer).to.eq(
      admin.address,
      "Signer address is the admin wallet"
    );
    expect(forwardParams.target).to.eq(
      msgSenderExample.address,
      "Target contract"
    );
    expect(forwardParams.value).to.eq(
      new BigNumber("0"),
      "No value is sent for relay hub"
    );
  }).timeout(50000);

  it("Sign a meta-transaction with bitflip and check the forward params are correct", async () => {
    const { relayHub, admin, msgSenderExample } = await loadFixture(createHubs);

    const callData = msgSenderExample.interface.functions.willRevert.encode([]);

    const forwarder = new RelayHubForwarder(
      ChainID.MAINNET,
      admin,
      relayHub.address,
      new BitFlipReplayProtection(admin, relayHub.address)
    );

    // @ts-ignore
    const forwardParams = await forwarder.signMetaTransaction({
      to: msgSenderExample.address,
      data: callData,
    });

    const decodedReplayProtection = defaultAbiCoder.decode(
      ["uint", "uint"],
      forwardParams.replayProtection
    );
    expect(forwardParams.chainId).to.eq(ChainID.MAINNET, "Mainnet chainID");
    expect(forwardParams.data).to.eq(callData, "Calldata");
    expect(forwardParams.to).to.eq(relayHub.address, "Relay hub address");
    expect(decodedReplayProtection[0].gt(new BigNumber("0"))).to.be.true;
    const bitFlipped = flipBit(new BigNumber("0"), new BigNumber("0"));
    expect(decodedReplayProtection[1]).to.eq(bitFlipped, "Nonce2");
    expect(forwardParams.replayProtectionAuthority).to.eq(
      "0x0000000000000000000000000000000000000001",
      "Bitflip replay protection"
    );
    expect(forwardParams.signer).to.eq(
      admin.address,
      "Signer address is the admin wallet"
    );
    expect(forwardParams.target).to.eq(
      msgSenderExample.address,
      "Target contract"
    );
    expect(forwardParams.value).to.eq(
      new BigNumber("0"),
      "No value is sent for relay hub"
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
    // @ts-ignore
    const forwardParams = await proxyForwarder.signMetaTransaction({
      to: msgSenderExample.address,
      data: callData,
    });

    const minimalTx = await proxyForwarder.encodeSignedMetaTransaction(
      forwardParams
    );

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

    const proxyForwarder = new RelayHubForwarder(
      ChainID.MAINNET,
      user2,
      relayHub.address,
      new BitFlipReplayProtection(user2, relayHub.address)
    );

    const callData = msgSenderExample.interface.functions.willRevert.encode([]);

    for (let j = 0; j < 10; j++) {
      for (let i = 0; i < 256; i++) {
        // @ts-ignore
        const forwardParams = await proxyForwarder.signMetaTransaction({
          to: msgSenderExample.address,
          data: callData,
        });

        const decodedReplayProtection = defaultAbiCoder.decode(
          ["uint", "uint"],
          forwardParams.replayProtection
        );
        expect(forwardParams.chainId).to.eq(ChainID.MAINNET, "Mainnet chainID");
        expect(forwardParams.data).to.eq(callData, "Calldata");
        expect(forwardParams.to).to.eq(relayHub.address);
        expect(decodedReplayProtection[0].gt(new BigNumber("0"))).to.be.true;
        const bitFlipped = flipBit(new BigNumber("0"), new BigNumber(i));
        expect(decodedReplayProtection[1]).to.eq(bitFlipped, "Nonce2");
        expect(forwardParams.replayProtectionAuthority).to.eq(
          "0x0000000000000000000000000000000000000001",
          "Bitflip replay protection"
        );
        expect(forwardParams.signer).to.eq(
          user2.address,
          "Signer address is the admin wallet"
        );
        expect(forwardParams.target).to.eq(
          msgSenderExample.address,
          "Target contract"
        );
        expect(forwardParams.value).to.eq("0");
      }
    }
  }).timeout(500000);

  it("ForwarderFactory ignores value for the RelayHub if the types are mixed up (ProxyAccountCallData instead of RelayHubCallData) the types are mixed up accidently.", async () => {
    const { admin, msgSenderExample, forwarderFactory } = await loadFixture(
      createHubs
    );

    const callData = msgSenderExample.interface.functions.willRevert.encode([]);
    const forwarder: Forwarder<ProxyAccountCallData> = await forwarderFactory.createNew(
      ChainID.MAINNET,
      ReplayProtectionType.MULTINONCE,
      admin
    );

    //@ts-ignore
    const encoded = forwarder.getEncodedCallData({
      to: msgSenderExample.address,
      value: new BigNumber("10"),
      data: callData,
    });

    const decode = defaultAbiCoder.decode(
      ["uint", "address", "bytes"],
      encoded
    );
    expect(decode[0]).to.eq(0);
    expect(decode[1]).to.eq(msgSenderExample.address);
    expect(decode[2]).to.eq(callData);
  }).timeout(50000);

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

    const minimaltx = await forwarder.signAndEncodeBatchTransaction(metaTxList);

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

    const minimaltx = await forwarder.signAndEncodeBatchTransaction(metaTxList);

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

    const minimaltx = await forwarder.signAndEncodeBatchTransaction(metaTxList);

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

    const minimaltx = await forwarder.signAndEncodeBatchTransaction(metaTxList);

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

    const minimaltx = await forwarder.signAndEncodeBatchTransaction(metaTxList);

    const tx = admin.sendTransaction({
      to: minimaltx.to,
      data: minimaltx.data,
    });

    await expect(tx).to.be.revertedWith("Meta-transaction failed");

    const lastMessage = await echoCon.lastMessage();
    expect(lastMessage).to.eq("");
  }).timeout(500000);
});
