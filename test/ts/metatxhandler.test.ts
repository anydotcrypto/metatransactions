import "mocha";
import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
import { solidity, loadFixture } from "ethereum-waffle";
import { BigNumber, defaultAbiCoder } from "ethers/utils";
import {
  RelayHubFactory,
  MetaTxHandler,
  MsgSenderExampleFactory,
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

const expect = chai.expect;
chai.use(solidity);
chai.use(chaiAsPromised);

async function createHubs(provider: Provider, [admin]: Wallet[]) {
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
    msgSenderExample,
  };
}

describe("Meta Transaction Handler", () => {
  // The "spy" in the other tests is carrying over here. Reset() will not fix it.
  // it("Check the hard-coded addresses for ropsten and mainnet", async () => {
  //   const spiedMetaTxHandler = spy(MetaTxHandler);

  //   // resetCalls(spiedMetaTxHandler);

  //   spiedMetaTxHandler.getForwarderAddress(
  //     ChainID.MAINNET,
  //     ForwarderType.PROXYHUB
  //   );

  //   const mainnetProxyAccountFactory = MetaTxHandler.getForwarderAddress(
  //     ChainID.MAINNET,
  //     ForwarderType.PROXYHUB
  //   );

  //   expect(mainnetProxyAccountFactory).to.eq("0x0b116DF91Aae33d85840165c5487462E0E821242");

  //   const ropstenProxyAccountFactory = MetaTxHandler.getForwarderAddress(
  //     ChainID.ROPSTEN,
  //     ForwarderType.PROXYHUB
  //   );

  //   expect(ropstenProxyAccountFactory).to.eq("0x9b1D523DfA8A6b2B04d3A54D469b63525823ffC9");

  //   const mainnetRelayHub = MetaTxHandler.getForwarderAddress(
  //     ChainID.MAINNET,
  //     ForwarderType.RELAYHUB
  //   );

  //   expect(mainnetRelayHub).to.eq("0x70107abB312db18bD9AdDec39CE711374B09EBC1");

  //   const ropstenRelayHub = MetaTxHandler.getForwarderAddress(
  //     ChainID.ROPSTEN,
  //     ForwarderType.RELAYHUB
  //   );

  //   expect(ropstenRelayHub).to.eq("0xE206a5C07aDE5ff4BA8805E68Fb0A52e12aE7798");
  // }).timeout(50000);

  it("Confirm the CHAINID values correspond to the various networks", async () => {
    expect(ChainID.MAINNET).to.eq(1);
    expect(ChainID.ROPSTEN).to.eq(3);
  }).timeout(50000);

  it("There is no hard-coded address for a proxy account and getHubAddress() should throw an error.", async () => {
    expect(
      MetaTxHandler.getForwarderAddress.bind(
        ChainID.MAINNET,
        ForwarderType.PROXYACCOUNT
      )
    ).to.throw("Please specify a valid ChainID and ContractType");
  }).timeout(50000);

  it("Create the RelayForwarder with Nonce ", async () => {
    const { relayHub, admin, msgSenderExample } = await loadFixture(createHubs);
    const proxyForwarder = MetaTxHandler.getRelayHubForwarder(
      ChainID.MAINNET,
      ReplayProtectionType.NONCE,
      admin
    );
    const callData = msgSenderExample.interface.functions.willRevert.encode([]);

    for (let i = 0; i < 10; i++) {
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
    const proxyForwarder = MetaTxHandler.getRelayHubForwarder(
      ChainID.MAINNET,
      ReplayProtectionType.MULTINONCE,
      admin
    );
    const callData = msgSenderExample.interface.functions.willRevert.encode([]);

    for (let i = 0; i < 10; i++) {
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
    const { relayHub, admin, msgSenderExample } = await loadFixture(createHubs);
    const proxyForwarder = MetaTxHandler.getRelayHubForwarder(
      ChainID.MAINNET,
      ReplayProtectionType.BITFLIP,
      admin
    );
    const callData = msgSenderExample.interface.functions.willRevert.encode([]);

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
    const { admin, msgSenderExample } = await loadFixture(createHubs);
    const proxyForwarder = await MetaTxHandler.getProxyForwarder(
      ChainID.MAINNET,
      ReplayProtectionType.NONCE,
      admin
    );
    const callData = msgSenderExample.interface.functions.willRevert.encode([]);

    for (let i = 0; i < 10; i++) {
      const forwardParams = await proxyForwarder.signMetaTransaction({
        target: msgSenderExample.address,
        value: new BigNumber("10"),
        callData,
      });

      const decodedReplayProtection = defaultAbiCoder.decode(
        ["uint", "uint"],
        forwardParams.replayProtection
      );
      expect(forwardParams.chainId).to.eq(ChainID.MAINNET, "Mainnet chainID");
      expect(forwardParams.data).to.eq(callData, "Calldata");
      expect(forwardParams.to).to.eq(
        await proxyForwarder.getProxyAddress(),
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
    const { admin, msgSenderExample } = await loadFixture(createHubs);
    const proxyForwarder = await MetaTxHandler.getProxyForwarder(
      ChainID.MAINNET,
      ReplayProtectionType.MULTINONCE,
      admin
    );
    const callData = msgSenderExample.interface.functions.willRevert.encode([]);

    for (let i = 0; i < 10; i++) {
      const forwardParams = await proxyForwarder.signMetaTransaction({
        target: msgSenderExample.address,
        value: new BigNumber("10"),
        callData,
      });

      const decodedReplayProtection = defaultAbiCoder.decode(
        ["uint", "uint"],
        forwardParams.replayProtection
      );
      expect(forwardParams.chainId).to.eq(ChainID.MAINNET, "Mainnet chainID");
      expect(forwardParams.data).to.eq(callData, "Calldata");
      expect(forwardParams.to).to.eq(
        await proxyForwarder.getProxyAddress(),
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
    const { admin, msgSenderExample } = await loadFixture(createHubs);
    const proxyForwarder = await MetaTxHandler.getProxyForwarder(
      ChainID.MAINNET,
      ReplayProtectionType.BITFLIP,
      admin
    );
    const callData = msgSenderExample.interface.functions.willRevert.encode([]);

    const forwardParams = await proxyForwarder.signMetaTransaction({
      target: msgSenderExample.address,
      value: new BigNumber("10"),
      callData,
    });

    const decodedReplayProtection = defaultAbiCoder.decode(
      ["uint", "uint"],
      forwardParams.replayProtection
    );
    expect(forwardParams.chainId).to.eq(ChainID.MAINNET, "Mainnet chainID");
    expect(forwardParams.data).to.eq(callData, "Calldata");
    expect(forwardParams.to).to.eq(
      await proxyForwarder.getProxyAddress(),
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
