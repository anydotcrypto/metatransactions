import "mocha";
import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
import { solidity, loadFixture } from "ethereum-waffle";
import { BigNumber, defaultAbiCoder } from "ethers/utils";
import {
  RelayHubFactory,
  ForwarderFactory,
  MsgSenderExampleFactory,
  ProxyAccountDeployerFactory,
  ProxyAccountForwarderFactory,
  RelayHubForwarderFactory,
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

  const spiedProxyForwarderFactory = spy(proxyAccountsForwardersFactory);
  const spiedRelayHubForwarderFactory = spy(relayHubForwardsFactory);

  when(
    // @ts-ignore
    spiedRelayHubForwarderFactory.getDeployedRelayHubAddress(ChainID.MAINNET)
  ).thenReturn(relayHub.address);

  when(
    // @ts-ignore
    spiedProxyForwarderFactory.getProxyAccountDeployerAddress(ChainID.MAINNET)
  ).thenReturn(proxyDeployer.address);

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
  // The "spy" in the other tests is carrying over here. Reset() will not fix it.
  // it("Check the hard-coded addresses for ropsten and mainnet", async () => {
  //   const spiedForwarderFactory = spy(ForwarderFactory);

  //   // resetCalls(spiedForwarderFactory);

  //   spiedForwarderFactory.getForwarderAddress(
  //     ChainID.MAINNET,
  //     ForwarderType.PROXYACCOUNTDEPLOYER
  //   );

  //   const mainnetProxyAccountFactory = ForwarderFactory.getForwarderAddress(
  //     ChainID.MAINNET,
  //     ForwarderType.PROXYACCOUNTDEPLOYER
  //   );

  //   expect(mainnetProxyAccountFactory).to.eq("0x0b116DF91Aae33d85840165c5487462E0E821242");

  //   const ropstenProxyAccountFactory = ForwarderFactory.getForwarderAddress(
  //     ChainID.ROPSTEN,
  //     ForwarderType.PROXYACCOUNTDEPLOYER
  //   );

  //   expect(ropstenProxyAccountFactory).to.eq("0x9b1D523DfA8A6b2B04d3A54D469b63525823ffC9");

  //   const mainnetRelayHub = ForwarderFactory.getForwarderAddress(
  //     ChainID.MAINNET,
  //     ForwarderType.RELAYHUB
  //   );

  //   expect(mainnetRelayHub).to.eq("0x70107abB312db18bD9AdDec39CE711374B09EBC1");

  //   const ropstenRelayHub = ForwarderFactory.getForwarderAddress(
  //     ChainID.ROPSTEN,
  //     ForwarderType.RELAYHUB
  //   );

  //   expect(ropstenRelayHub).to.eq("0xE206a5C07aDE5ff4BA8805E68Fb0A52e12aE7798");
  // }).timeout(50000);

  it("Confirm the CHAINID values correspond to the various networks", async () => {
    expect(ChainID.MAINNET).to.eq(1);
    expect(ChainID.ROPSTEN).to.eq(3);
  }).timeout(50000);

  it("Create the RelayForwarder with Nonce ", async () => {
    const {
      relayHub,
      admin,
      msgSenderExample,
      relayHubForwardsFactory,
    } = await loadFixture(createHubs);
    const proxyForwarder = await relayHubForwardsFactory.createNew(
      ChainID.MAINNET,
      ReplayProtectionType.NONCE,
      admin
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
    const {
      relayHub,
      admin,
      msgSenderExample,
      relayHubForwardsFactory,
    } = await loadFixture(createHubs);
    const relayForwarder = await relayHubForwardsFactory.createNew(
      ChainID.MAINNET,
      ReplayProtectionType.MULTINONCE,
      admin
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
    const relayForwarder = await relayHubForwardsFactory.createNew(
      ChainID.MAINNET,
      ReplayProtectionType.BITFLIP,
      admin
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
        await proxyForwarder.getAddress(),
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
        await proxyForwarder.getAddress(),
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
      await proxyForwarder.getAddress(),
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
