import "mocha";
import * as chai from "chai";
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
  deployMetaTxContracts,
} from "../../src";

import { Provider } from "ethers/providers";
import { Wallet } from "ethers/wallet";
import {
  ChainID,
  ReplayProtectionType,
} from "../../src/ts/forwarders/forwarderFactory";

const expect = chai.expect;
chai.use(solidity);

async function createHubs(provider: Provider, [admin]: Wallet[]) {
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
        "Multinonce replay protection"
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
        "Multinonce replay protection"
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
    const { relayHub, admin, msgSenderExample } = await loadFixture(createHubs);
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
    expect(decodedReplayProtection[0].gt(new BigNumber("0"))).to.be.true;
    expect(decodedReplayProtection[1]).to.eq(new BigNumber("1"), "Nonce2"); // One bit flipped
    expect(forwardParams.replayProtectionAuthority).to.eq(
      "0x0000000000000000000000000000000000000001",
      "Bitflip address"
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
    const proxyForwarder = await proxyAccountsForwardersFactory.createNew(
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
        "Multinonce replay protection"
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
    const proxyForwarder = await proxyAccountsForwardersFactory.createNew(
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
        "Multinonce replay protection"
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
    const proxyForwarder = await proxyAccountsForwardersFactory.createNew(
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
    expect(decodedReplayProtection[0].gt(new BigNumber("0"))).to.be.true;
    expect(decodedReplayProtection[1]).to.eq(new BigNumber("1"), "Nonce2");
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
      new BigNumber("10"),
      "10 coins sent to the proxy hub"
    );
  }).timeout(50000);
});
