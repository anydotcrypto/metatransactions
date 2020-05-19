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
} from "../../src";

import { Provider } from "ethers/providers";
import { Wallet } from "ethers/wallet";
import {
  ChainID,
  ReplayProtectionType,
} from "../../src/ts/forwarders/forwarderFactory";
import {
  Forwarder,
  ProxyAccountCallData,
} from "../../src/ts/forwarders/forwarder";
import { RelayHubForwarder } from "../../src/ts/forwarders/relayHubForwarder";
import { flipBit } from "../utils/test-utils";

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

  const forwarderFactory = new RelayHubForwarderFactory();
  return {
    relayHub,
    proxyDeployer,
    admin,
    user1,
    user2,
    msgSenderExample,
    forwarderFactory,
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
    const forwardParams = await proxyForwarder.signMetaTransaction({
      to: msgSenderExample.address,
      data: callData,
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
      user2,
      relayHub.address,
      new BitFlipReplayProtection(user2, relayHub.address)
    );

    const callData = msgSenderExample.interface.functions.willRevert.encode([]);

    for (let j = 0; j < 10; j++) {
      for (let i = 0; i < 256; i++) {
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

    const decode = defaultAbiCoder.decode(["address", "bytes"], encoded);

    expect(decode[0]).to.eq(msgSenderExample.address);
    expect(decode[1]).to.eq(callData);
  }).timeout(50000);

  it("Deploy a new meta-contract with the RelayHub installed.", async () => {
    const { relayHub, admin } = await loadFixture(createHubs);

    const forwarder = new RelayHubForwarder(
      ChainID.MAINNET,
      admin,
      relayHub.address,
      new MultiNonceReplayProtection(30, admin, relayHub.address)
    );

    const initCode = new MsgSenderExampleFactory(admin).getDeployTransaction(
      relayHub.address
    ).data! as string;

    const deploymentParams = await forwarder.signMetaDeployment(initCode);

    const decodedReplayProtection = defaultAbiCoder.decode(
      ["uint", "uint"],
      deploymentParams.replayProtection
    );

    expect(deploymentParams.to).to.eq(relayHub.address);
    expect(deploymentParams.signer).to.eq(admin.address);
    expect(deploymentParams.initCode).to.eq(initCode);
    expect(decodedReplayProtection[0]).to.eq(new BigNumber("0"), "Nonce1");
    expect(decodedReplayProtection[1]).to.eq(new BigNumber("0"), "Nonce2");
    expect(deploymentParams.replayProtectionAuthority).to.eq(
      "0x0000000000000000000000000000000000000000",
      "Bitflip replay protection"
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

  it("Encode the meta-deployment before publishing to the network", async () => {
    const { relayHub, admin, user2 } = await loadFixture(createHubs);

    const forwarder = new RelayHubForwarder(
      ChainID.MAINNET,
      admin,
      relayHub.address,
      new MultiNonceReplayProtection(30, admin, relayHub.address)
    );

    const initCode = new MsgSenderExampleFactory(admin).getDeployTransaction(
      relayHub.address
    ).data! as string;

    const deploymentParams = await forwarder.signMetaDeployment(initCode);

    const decodedReplayProtection = defaultAbiCoder.decode(
      ["uint", "uint"],
      deploymentParams.replayProtection
    );

    expect(deploymentParams.to).to.eq(relayHub.address);
    expect(deploymentParams.signer).to.eq(admin.address);
    expect(deploymentParams.initCode).to.eq(initCode);
    expect(decodedReplayProtection[0]).to.eq(new BigNumber("0"), "Nonce1");
    expect(decodedReplayProtection[1]).to.eq(new BigNumber("0"), "Nonce2");
    expect(deploymentParams.replayProtectionAuthority).to.eq(
      "0x0000000000000000000000000000000000000000",
      "Bitflip replay protection"
    );
    expect(deploymentParams.chainId).to.eq(ChainID.MAINNET);

    const encodedMetaDeployment = await forwarder.encodeSignedMetaDeployment(
      deploymentParams
    );

    const tx = await user2.sendTransaction({
      to: deploymentParams.to,
      data: encodedMetaDeployment,
    });

    const receipt = await tx.wait(1);

    // Successfully deployed
    expect(receipt.status).to.eq(1);

    // Compute deterministic address
    const msgSenderExampleAddress = forwarder.buildDeployedContractAddress(
      deploymentParams
    );

    const msgSenderExample = new MsgSenderExampleFactory(admin).attach(
      msgSenderExampleAddress
    );

    // Try executing a function - it should exist and work
    const msgSenderTx = msgSenderExample.connect(admin).test();
    await expect(msgSenderTx)
      .to.emit(
        msgSenderExample,
        msgSenderExample.interface.events.WhoIsSender.name
      )
      .withArgs(admin.address);
  }).timeout(50000);
});
