import "mocha";
import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
import { solidity, loadFixture } from "ethereum-waffle";
import { BigNumber, defaultAbiCoder } from "ethers/utils";
import {
  RelayHubFactory,
  MsgSenderExampleFactory,
  ProxyAccountDeployerFactory,
  ProxyAccountForwarderFactory,
  RelayHubForwarderFactory,
  RelayHubForwarder,
  MultiNonceReplayProtection,
  BitFlipReplayProtection,
} from "../../src";
import { when, spy } from "ts-mockito";

import { Provider } from "ethers/providers";
import { Wallet } from "ethers/wallet";
import {
  ChainID,
  ReplayProtectionType,
} from "../../src/ts/forwarders/forwarderFactory";

const expect = chai.expect;
chai.use(solidity);
chai.use(chaiAsPromised);

async function createHubs(provider: Provider, [admin]: Wallet[]) {
  const relayHubFactory = new RelayHubFactory(admin);
  const relayHubCreationTx = relayHubFactory.getDeployTransaction();

  const relayHubCreation = await admin.sendTransaction(relayHubCreationTx);
  const relayResult = await relayHubCreation.wait(1);

  const relayHub = relayHubFactory.attach(relayResult.contractAddress!);

  const proxyDeployerFactory = new ProxyAccountDeployerFactory(admin);
  const proxyDeployerCreationTx = proxyDeployerFactory.getDeployTransaction();

  const proxyDeployerCreation = await admin.sendTransaction(
    proxyDeployerCreationTx
  );
  const proxyResult = await proxyDeployerCreation.wait(1);

  const proxyDeployer = proxyDeployerFactory.attach(
    proxyResult.contractAddress!
  );

  const msgSenderExample = await new MsgSenderExampleFactory(admin).deploy(
    relayHub.address
  );

  const proxyAccountsForwardersFactory = new ProxyAccountForwarderFactory();
  const relayHubForwardsFactory = new RelayHubForwarderFactory();

  return {
    relayHub,
    proxyDeployer,
    admin,
    msgSenderExample,
    proxyAccountsForwardersFactory,
    relayHubForwardsFactory,
  };
}

describe("Forwarder Factory", () => {
  it("Confirm the CHAINID values correspond to the various networks", async () => {
    expect(ChainID.MAINNET).to.eq(1);
    expect(ChainID.ROPSTEN).to.eq(3);
  }).timeout(50000);

  it("Create the RelayForwarder with Nonce ", async () => {
    const { relayHub, admin, msgSenderExample } = await loadFixture(createHubs);
    const proxyForwarder = new RelayHubForwarder(
      ChainID.MAINNET,
      admin,
      relayHub.address,
      new MultiNonceReplayProtection(1, admin, relayHub.address)
    );

    const callData = msgSenderExample.interface.functions.willRevert.encode([]);

    for (let i = 0; i < 10; i++) {
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
      expect(forwardParams.to).to.eq(relayHub.address, "RelayHub address");
      expect(decodedReplayProtection[0]).to.eq(new BigNumber("0"), "Nonce1");
      expect(decodedReplayProtection[1]).to.eq(new BigNumber(i), "Nonce2");
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
      expect(forwardParams.value).to.eq(new BigNumber("0"), "0 coins");
    }
  }).timeout(50000);

  it("Create the RelayForwarder with MultiNonce ", async () => {
    const { relayHub, admin, msgSenderExample } = await loadFixture(createHubs);
    const relayForwarder = new RelayHubForwarder(
      ChainID.MAINNET,
      admin,
      relayHub.address,
      new MultiNonceReplayProtection(30, admin, relayHub.address)
    );
    const callData = msgSenderExample.interface.functions.willRevert.encode([]);

    for (let i = 0; i < 10; i++) {
      const forwardParams = await relayForwarder.signMetaTransaction({
        to: msgSenderExample.address,
        data: callData,
      });

      const decodedReplayProtection = defaultAbiCoder.decode(
        ["uint", "uint"],
        forwardParams.replayProtection
      );
      expect(forwardParams.chainId).to.eq(ChainID.MAINNET, "Mainnet chainID");
      expect(forwardParams.data).to.eq(callData, "Calldata");
      expect(forwardParams.to).to.eq(relayHub.address, "RelayHub address");
      expect(decodedReplayProtection[0]).to.eq(new BigNumber(i), "Nonce1");
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
      expect(forwardParams.value).to.eq(new BigNumber("0"), "0 coins");
    }
  }).timeout(50000);

  it("Create the RelayForwarder with Bitflip ", async () => {
    const {
      relayHub,
      admin,
      msgSenderExample,
      relayHubForwardsFactory,
    } = await loadFixture(createHubs);
    const relayForwarder = new RelayHubForwarder(
      ChainID.MAINNET,
      admin,
      relayHub.address,
      new BitFlipReplayProtection(admin, relayHub.address)
    );
    const callData = msgSenderExample.interface.functions.willRevert.encode([]);

    const forwardParams = await relayForwarder.signMetaTransaction({
      to: msgSenderExample.address,
      data: callData,
    });

    const decodedReplayProtection = defaultAbiCoder.decode(
      ["uint", "uint"],
      forwardParams.replayProtection
    );
    expect(forwardParams.chainId).to.eq(ChainID.MAINNET, "Mainnet chainID");
    expect(forwardParams.data).to.eq(callData, "Calldata");
    expect(forwardParams.to).to.eq(relayHub.address, "RelayHub address");
    expect(decodedReplayProtection[0].gt(new BigNumber("6174"))).to.be.true;
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
    expect(forwardParams.value).to.eq(new BigNumber("0"), "0 coins sent");
  }).timeout(50000);

  it("Create the ProxyForwarder with Nonce ", async () => {
    const {
      admin,
      msgSenderExample,
      proxyAccountsForwardersFactory,
    } = await loadFixture(createHubs);
    const proxyForwarder = proxyAccountsForwardersFactory.createNew(
      ChainID.MAINNET,
      ReplayProtectionType.NONCE,
      admin
    );
    const callData = msgSenderExample.interface.functions.willRevert.encode([]);

    for (let i = 0; i < 10; i++) {
      const forwardParams = await proxyForwarder.signMetaTransaction({
        to: msgSenderExample.address,
        value: new BigNumber("10"),
        data: callData,
      });

      const decodedReplayProtection = defaultAbiCoder.decode(
        ["uint", "uint"],
        forwardParams.replayProtection
      );
      expect(forwardParams.chainId).to.eq(ChainID.MAINNET, "Mainnet chainID");
      expect(forwardParams.data).to.eq(callData, "Calldata");
      expect(forwardParams.to).to.eq(
        proxyForwarder.address,
        "Proxy account address"
      );
      expect(decodedReplayProtection[0]).to.eq(new BigNumber(0), "Nonce1");
      expect(decodedReplayProtection[1]).to.eq(new BigNumber(i), "Nonce2");
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
        new BigNumber("10"),
        "10 coins sent to the proxy hub"
      );
    }
  }).timeout(50000);

  it("Create the ProxyForwarder with MultiNonce ", async () => {
    const {
      admin,
      msgSenderExample,
      proxyAccountsForwardersFactory,
    } = await loadFixture(createHubs);
    const proxyForwarder = proxyAccountsForwardersFactory.createNew(
      ChainID.MAINNET,
      ReplayProtectionType.MULTINONCE,
      admin
    );
    const callData = msgSenderExample.interface.functions.willRevert.encode([]);

    for (let i = 0; i < 10; i++) {
      const forwardParams = await proxyForwarder.signMetaTransaction({
        to: msgSenderExample.address,
        value: new BigNumber("10"),
        data: callData,
      });

      const decodedReplayProtection = defaultAbiCoder.decode(
        ["uint", "uint"],
        forwardParams.replayProtection
      );
      expect(forwardParams.chainId).to.eq(ChainID.MAINNET, "Mainnet chainID");
      expect(forwardParams.data).to.eq(callData, "Calldata");
      expect(forwardParams.to).to.eq(
        proxyForwarder.address,
        "Proxy account address"
      );
      expect(decodedReplayProtection[0]).to.eq(new BigNumber(i), "Nonce1");
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
        new BigNumber("10"),
        "10 coins sent to the proxy hub"
      );
    }
  }).timeout(50000);

  it("Create the ProxyForwarder with Bitflip ", async () => {
    const {
      admin,
      msgSenderExample,
      proxyAccountsForwardersFactory,
    } = await loadFixture(createHubs);
    const proxyForwarder = proxyAccountsForwardersFactory.createNew(
      ChainID.MAINNET,
      ReplayProtectionType.BITFLIP,
      admin
    );
    const callData = msgSenderExample.interface.functions.willRevert.encode([]);

    const forwardParams = await proxyForwarder.signMetaTransaction({
      to: msgSenderExample.address,
      value: new BigNumber("10"),
      data: callData,
    });

    const decodedReplayProtection = defaultAbiCoder.decode(
      ["uint", "uint"],
      forwardParams.replayProtection
    );
    expect(forwardParams.chainId).to.eq(ChainID.MAINNET, "Mainnet chainID");
    expect(forwardParams.data).to.eq(callData, "Calldata");
    expect(forwardParams.to).to.eq(
      proxyForwarder.address,
      "Proxy account address"
    );
    expect(decodedReplayProtection[0].gt(new BigNumber("6174"))).to.be.true;
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
      new BigNumber("10"),
      "10 coins sent to the proxy hub"
    );
  }).timeout(50000);
});