import "mocha";
import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
import { solidity, loadFixture } from "ethereum-waffle";
import { BigNumber, defaultAbiCoder } from "ethers/utils";
import {
  RelayHubFactory,
  MetaTxHandler,
  MsgSenderExampleFactory,
  BitFlip,
  MultiNonce,
  ProxyAccountDeployerFactory,
} from "../../src";
import { when, spy } from "ts-mockito";

import { Provider } from "ethers/providers";
import { Wallet } from "ethers/wallet";
import {
  ChainID,
  ForwarderType,
  ReplayProtectionType,
} from "../../src/ts/metatxhandler";
import { Forwarder, ProxyCallData } from "../../src/ts/forwarder";
import { RelayHubForwarder } from "../../src/ts/relayforwarder";

const expect = chai.expect;
chai.use(solidity);
chai.use(chaiAsPromised);

async function createHubs(provider: Provider, [admin, user1, user2]: Wallet[]) {
  const relayHubFactory = new RelayHubFactory(admin);
  const relayHubCreationTx = relayHubFactory.getDeployTransaction();

  const relayHubCreation = await admin.sendTransaction(relayHubCreationTx);
  const relayResult = await relayHubCreation.wait(1);

  const relayHub = relayHubFactory.attach(relayResult.contractAddress!);

  const proxyHubFactory = new ProxyAccountDeployerFactory(admin);
  const proxyHubCreationTx = proxyHubFactory.getDeployTransaction();

  const proxyHubCreation = await admin.sendTransaction(proxyHubCreationTx);
  const proxyResult = await proxyHubCreation.wait(1);

  const proxyHub = proxyHubFactory.attach(proxyResult.contractAddress!);

  const msgSenderExample = await new MsgSenderExampleFactory(admin).deploy(
    relayHub.address
  );

  const spiedMetaTxHandler = spy(MetaTxHandler);
  when(
    spiedMetaTxHandler.getForwarderAddress(
      ChainID.MAINNET,
      ForwarderType.RELAYHUB
    )
  ).thenReturn(relayHub.address);

  when(
    spiedMetaTxHandler.getForwarderAddress(
      ChainID.MAINNET,
      ForwarderType.PROXYHUB
    )
  ).thenReturn(proxyHub.address);

  return {
    relayHub,
    proxyHub,
    admin,
    user1,
    user2,
    msgSenderExample,
  };
}

describe("RelayHub Forwarder", () => {
  it("Sign a meta-transaction with multinonce and check the forward params are correct", async () => {
    const { relayHub, admin, msgSenderExample } = await loadFixture(createHubs);

    const callData = msgSenderExample.interface.functions.willRevert.encode([]);

    const metaTxHandler = MetaTxHandler.getRelayHubForwarder(
      ChainID.MAINNET,
      ReplayProtectionType.MULTINONCE,
      admin
    );

    const forwardParams = await metaTxHandler.signMetaTransaction({
      target: msgSenderExample.address,
      callData,
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
      "Built-in replay protection"
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

    const metaTxHandler = MetaTxHandler.getRelayHubForwarder(
      ChainID.MAINNET,
      ReplayProtectionType.BITFLIP,
      admin
    );
    const forwardParams = await metaTxHandler.signMetaTransaction({
      target: msgSenderExample.address,
      callData,
    });

    const decodedReplayProtection = defaultAbiCoder.decode(
      ["uint", "uint"],
      forwardParams.replayProtection
    );
    expect(forwardParams.chainId).to.eq(ChainID.MAINNET, "Mainnet chainID");
    expect(forwardParams.data).to.eq(callData, "Calldata");
    expect(forwardParams.to).to.eq(relayHub.address, "Relay hub address");
    expect(decodedReplayProtection[0].gt(new BigNumber("6174"))).to.be.true; // Picks a randon number greater than 6174
    expect(decodedReplayProtection[1]).to.eq(new BigNumber("0"), "Nonce2");
    expect(forwardParams.replayProtectionAuthority).to.eq(
      "0x0000000000000000000000000000000000000000",
      "Built-in replay protection"
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
      relayHub,
      user1,
      new MultiNonce(noQueues, user1, relayHub.address)
    );

    const callData = msgSenderExample.interface.functions.test.encode([]);
    const forwardParams = await proxyForwarder.signMetaTransaction({
      target: msgSenderExample.address,
      callData,
    });

    const encoded = await proxyForwarder.encodeSignedMetaTransaction(
      forwardParams
    );

    const tx = user1.sendTransaction({
      to: forwardParams.to,
      data: encoded,
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
      relayHub,
      user2,
      new BitFlip(user2, relayHub.address)
    );

    const callData = msgSenderExample.interface.functions.willRevert.encode([]);

    for (let j = 0; j < 10; j++) {
      for (let i = 0; i < 256; i++) {
        const forwardParams = await proxyForwarder.signMetaTransaction({
          target: msgSenderExample.address,
          callData,
        });

        const decodedReplayProtection = defaultAbiCoder.decode(
          ["uint", "uint"],
          forwardParams.replayProtection
        );
        expect(forwardParams.chainId).to.eq(ChainID.MAINNET, "Mainnet chainID");
        expect(forwardParams.data).to.eq(callData, "Calldata");
        expect(forwardParams.to).to.eq(relayHub.address);
        expect(decodedReplayProtection[0].gt(new BigNumber("6174"))).to.be.true;
        expect(decodedReplayProtection[1]).to.eq(new BigNumber(i), "Nonce2");
        expect(forwardParams.replayProtectionAuthority).to.eq(
          "0x0000000000000000000000000000000000000000",
          "Built-in replay protection"
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

  // TODO: Should we throw an error here? Or let it gracefully set to 0.
  it("MetaTxHandler ignores value for the RelayHub if the types are mixed up (ProxyCallData instead of RelayCallData) the types are mixed up accidently.", async () => {
    const { admin, msgSenderExample } = await loadFixture(createHubs);

    const callData = msgSenderExample.interface.functions.willRevert.encode([]);
    const metaTxHandler: Forwarder<ProxyCallData> = MetaTxHandler.getRelayHubForwarder(
      ChainID.MAINNET,
      ReplayProtectionType.MULTINONCE,
      admin
    );

    //@ts-ignore
    const encoded = await metaTxHandler.getEncodedCallData({
      target: msgSenderExample.address,
      value: new BigNumber("10"),
      callData,
    });

    const decode = defaultAbiCoder.decode(["address", "bytes"], encoded);

    expect(decode[0]).to.eq(msgSenderExample.address);
    expect(decode[1]).to.eq(callData);
  }).timeout(50000);

  it("Deploy a new meta-contract with the RelayHub installed.", async () => {
    const { relayHub, admin } = await loadFixture(createHubs);

    const metaTxHandler = MetaTxHandler.getRelayHubForwarder(
      ChainID.MAINNET,
      ReplayProtectionType.MULTINONCE,
      admin
    );

    const initCode = new MsgSenderExampleFactory(admin).getDeployTransaction(
      relayHub.address
    ).data! as string;

    const deploymentParams = await metaTxHandler.signMetaDeployment(initCode);

    const decodedReplayProtection = defaultAbiCoder.decode(
      ["uint", "uint"],
      deploymentParams.replayProtection
    );

    expect(deploymentParams.to).to.eq(relayHub.address);
    expect(deploymentParams.signer).to.eq(admin.address);
    expect(deploymentParams.initCode).to.eq(initCode);
    expect(decodedReplayProtection[0]).to.eq(new BigNumber("0"), "Nonce1"); // Picks a randon number greater than 6174
    expect(decodedReplayProtection[1]).to.eq(new BigNumber("0"), "Nonce2");
    expect(deploymentParams.replayProtectionAuthority).to.eq(
      "0x0000000000000000000000000000000000000000",
      "Built-in replay protection"
    );
    expect(deploymentParams.chainId).to.eq(ChainID.MAINNET);

    const tx = await relayHub.deployContract(
      deploymentParams.initCode,
      deploymentParams.replayProtection,
      deploymentParams.replayProtectionAuthority,
      deploymentParams.signer,
      deploymentParams.signature
    );

    const receipt = await tx.wait(1);

    // Successfully deployed
    expect(receipt.status).to.eq(1);
  }).timeout(50000);
});