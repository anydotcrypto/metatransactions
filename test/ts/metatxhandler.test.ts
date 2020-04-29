import "mocha";
import * as chai from "chai";
import { solidity, loadFixture } from "ethereum-waffle";
import { BigNumber, defaultAbiCoder } from "ethers/utils";
import {
  RelayHubFactory,
  ProxyHubFactory,
  MetaTxHandler,
  MsgSenderExampleFactory,
  ProxyAccountFactory,
} from "../../src";
import { when, spy } from "ts-mockito";

import { Provider } from "ethers/providers";
import { Wallet } from "ethers/wallet";
import { ChainID, ContractType } from "../../src/ts/metatxhandler";

const expect = chai.expect;
chai.use(solidity);

async function createHubs(provider: Provider, [admin]: Wallet[]) {
  const relayHubFactory = new RelayHubFactory(admin);
  const relayHubCreationTx = relayHubFactory.getDeployTransaction();

  const relayHubCreation = await admin.sendTransaction(relayHubCreationTx);
  const relayResult = await relayHubCreation.wait(1);

  const relayHub = relayHubFactory.attach(relayResult.contractAddress!);

  const proxyHubFactory = new ProxyHubFactory(admin);
  const proxyHubCreationTx = proxyHubFactory.getDeployTransaction();

  const proxyHubCreation = await admin.sendTransaction(proxyHubCreationTx);
  const proxyResult = await proxyHubCreation.wait(1);

  const proxyHub = proxyHubFactory.attach(proxyResult.contractAddress!);

  const msgSenderExample = await new MsgSenderExampleFactory(admin).deploy(
    relayHub.address
  );

  const spiedMetaTxHandler = spy(MetaTxHandler);
  when(
    spiedMetaTxHandler.getHubAddress(ChainID.MAINNET, ContractType.RELAYHUB)
  ).thenReturn(relayHub.address);

  when(
    spiedMetaTxHandler.getHubAddress(ChainID.MAINNET, ContractType.PROXYHUB)
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
  //   resetCalls(spiedMetaTxHandler);

  //   const mainnetProxyHub = MetaTxHandler.getHubAddress(
  //     ChainID.MAINNET,
  //     ContractType.PROXYHUB
  //   );

  //   expect(mainnetProxyHub).to.eq("0x0b116DF91Aae33d85840165c5487462E0E821242");

  //   const ropstenProxyHub = MetaTxHandler.getHubAddress(
  //     ChainID.ROPSTEN,
  //     ContractType.PROXYHUB
  //   );

  //   expect(ropstenProxyHub).to.eq("0x9b1D523DfA8A6b2B04d3A54D469b63525823ffC9");

  //   const mainnetRelayHub = MetaTxHandler.getHubAddress(
  //     ChainID.MAINNET,
  //     ContractType.RELAYHUB
  //   );

  //   expect(mainnetRelayHub).to.eq("0x70107abB312db18bD9AdDec39CE711374B09EBC1");

  //   const ropstenRelayHub = MetaTxHandler.getHubAddress(
  //     ChainID.ROPSTEN,
  //     ContractType.RELAYHUB
  //   );

  //   expect(ropstenRelayHub).to.eq("0xE206a5C07aDE5ff4BA8805E68Fb0A52e12aE7798");
  // }).timeout(50000);

  it("There is no hard-coded address for a proxy account and getHubAddress() should throw an error.", async () => {
    expect(
      MetaTxHandler.getHubAddress.bind(
        ChainID.MAINNET,
        ContractType.PROXYACCOUNT
      )
    ).to.throw("Please specify a valid ChainID and ContractType");
  }).timeout(50000);

  it("Sign a meta-transaction with multinonce and check the forward params are correct", async () => {
    const { relayHub, admin, msgSenderExample } = await loadFixture(createHubs);

    const callData = msgSenderExample.interface.functions.willRevert.encode([]);

    const metaTxHandler = MetaTxHandler.multinonce(
      ChainID.MAINNET,
      ContractType.RELAYHUB,
      100
    );
    const forwardParams = await metaTxHandler.signMetaTransaction(
      admin,
      msgSenderExample.address,
      new BigNumber("0"),
      callData
    );

    const decodedReplayProtection = defaultAbiCoder.decode(
      ["uint", "uint"],
      forwardParams.replayProtection
    );
    expect(forwardParams.chainId).to.eq(ChainID.MAINNET, "Mainnet chainID");
    expect(forwardParams.data).to.eq(callData, "Calldata");
    expect(forwardParams.hub).to.eq(relayHub.address, "Relay hub address");
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

    const metaTxHandler = MetaTxHandler.bitflip(
      ChainID.MAINNET,
      ContractType.RELAYHUB
    );
    const forwardParams = await metaTxHandler.signMetaTransaction(
      admin,
      msgSenderExample.address,
      new BigNumber("0"),
      callData
    );

    const decodedReplayProtection = defaultAbiCoder.decode(
      ["uint", "uint"],
      forwardParams.replayProtection
    );
    expect(forwardParams.chainId).to.eq(ChainID.MAINNET, "Mainnet chainID");
    expect(forwardParams.data).to.eq(callData, "Calldata");
    expect(forwardParams.hub).to.eq(relayHub.address, "Relay hub address");
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

  // TODO: Should we throw an error here? Or let it gracefully set to 0.
  it("MetaTxHandler throws if value set larger than 0 when the RelayHub is installed.", async () => {
    const { admin, msgSenderExample } = await loadFixture(createHubs);

    const callData = msgSenderExample.interface.functions.willRevert.encode([]);

    const metaTxHandler = MetaTxHandler.bitflip(
      ChainID.MAINNET,
      ContractType.RELAYHUB
    );

    return expect(
      metaTxHandler.signMetaTransaction(
        admin,
        msgSenderExample.address,
        new BigNumber("10"),
        callData
      )
    ).to.eventually.be.rejectedWith("Value must be 0 if RelayHub is installed");
  }).timeout(50000);

  it("Cannot instantiate a MetaTxHandler for a ProxyAccount", async () => {
    expect(
      MetaTxHandler.multinonce.bind(ChainID.MAINNET, ContractType.PROXYACCOUNT)
    ).to.throw("Please specify a valid ChainID and ContractType");

    expect(
      MetaTxHandler.bitflip.bind(ChainID.MAINNET, ContractType.PROXYACCOUNT)
    ).to.throw("Please specify a valid ChainID and ContractType");
  }).timeout(50000);

  it("Deploy proxy account and verify the correct address is computed.", async () => {
    const { proxyHub, admin } = await loadFixture(createHubs);

    const metaTxHandler = MetaTxHandler.bitflip(
      ChainID.MAINNET,
      ContractType.PROXYHUB
    );

    await metaTxHandler.createProxyContract(admin, admin.address);
    const proxyAccountAddress = await proxyHub.accounts(admin.address);

    expect(
      MetaTxHandler.buildCreate2Address(
        proxyHub.address,
        admin.address,
        await proxyHub.baseAccount()
      )
    ).to.eq(proxyAccountAddress.toLowerCase());
  }).timeout(50000);

  it("Tries to re-deploy the same proxy contract twice and fails.", async () => {
    const { proxyHub, admin } = await loadFixture(createHubs);

    const metaTxHandler = MetaTxHandler.bitflip(
      ChainID.MAINNET,
      ContractType.PROXYHUB
    );

    await metaTxHandler.createProxyContract(admin, admin.address);
    const proxyAccountAddress = await proxyHub.accounts(admin.address);

    expect(
      MetaTxHandler.buildCreate2Address(
        proxyHub.address,
        admin.address,
        await proxyHub.baseAccount()
      )
    ).to.eq(proxyAccountAddress.toLowerCase());

    // Try to re-deploy via the contract directly.
    expect(proxyHub.connect(admin).createProxyAccount(admin.address)).to.be
      .reverted;

    // Try to re-deploy via the library. Caught before sending transaction.
    return expect(
      metaTxHandler.createProxyContract(admin, admin.address)
    ).to.be.eventually.rejectedWith(
      "ProxyAccount for " + admin.address + " already exists."
    );
  }).timeout(50000);

  it("Tries to deploy a proxy account with the RelayHub installed and fails.", async () => {
    const { admin } = await loadFixture(createHubs);

    const metaTxHandler = MetaTxHandler.bitflip(
      ChainID.MAINNET,
      ContractType.RELAYHUB
    );

    // Try to re-deploy via the library. Caught before sending transaction.
    return expect(
      metaTxHandler.createProxyContract(admin, admin.address)
    ).to.be.eventually.rejectedWith(
      "ProxyHub must be installed to create a ProxyContract"
    );
  }).timeout(50000);

  it("Deploy a new meta-contract with the RelayHub installed.", async () => {
    const { relayHub, admin } = await loadFixture(createHubs);

    const metaTxHandler = MetaTxHandler.bitflip(
      ChainID.MAINNET,
      ContractType.RELAYHUB
    );

    const initCode = new MsgSenderExampleFactory(admin).getDeployTransaction(
      relayHub.address
    ).data! as string;

    const deploymentParams = await metaTxHandler.signMetaDeployment(
      admin,
      initCode
    );

    const decodedReplayProtection = defaultAbiCoder.decode(
      ["uint", "uint"],
      deploymentParams.replayProtection
    );
    expect(deploymentParams.hub).to.eq(relayHub.address);
    expect(deploymentParams.signer).to.eq(admin.address);
    expect(deploymentParams.data).to.eq(initCode);
    expect(decodedReplayProtection[0].gt(new BigNumber("6174"))).to.be.true; // Picks a randon number greater than 6174
    expect(decodedReplayProtection[1]).to.eq(new BigNumber("0"), "Nonce2");
    expect(deploymentParams.replayProtectionAuthority).to.eq(
      "0x0000000000000000000000000000000000000000",
      "Built-in replay protection"
    );
    expect(deploymentParams.chainId).to.eq(ChainID.MAINNET);

    const tx = await relayHub.deployContract(
      deploymentParams.data,
      deploymentParams.replayProtection,
      deploymentParams.replayProtectionAuthority,
      deploymentParams.signer,
      deploymentParams.signature
    );

    const receipt = await tx.wait(1);

    // Successfully deployed
    expect(receipt.status).to.eq(1);
  }).timeout(50000);

  it("Deploy a new meta-contract with the ProxyHub installed.", async () => {
    const { proxyHub, admin } = await loadFixture(createHubs);

    const metaTxHandler = MetaTxHandler.bitflip(
      ChainID.MAINNET,
      ContractType.PROXYHUB
    );

    const initCode = new MsgSenderExampleFactory(admin).getDeployTransaction(
      proxyHub.address
    ).data! as string;

    const deploymentParams = await metaTxHandler.signMetaDeployment(
      admin,
      initCode
    );

    await proxyHub.connect(admin).createProxyAccount(admin.address);
    const proxyAccountAddress = await proxyHub.accounts(admin.address);
    const proxyAccount = new ProxyAccountFactory(admin).attach(
      proxyAccountAddress
    );
    const decodedReplayProtection = defaultAbiCoder.decode(
      ["uint", "uint"],
      deploymentParams.replayProtection
    );

    expect(deploymentParams.hub.toLowerCase()).to.eq(
      proxyAccount.address.toLowerCase()
    );
    expect(deploymentParams.signer).to.eq(admin.address);
    expect(deploymentParams.data).to.eq(initCode);
    expect(decodedReplayProtection[0].gt(new BigNumber("6174"))).to.be.true; // Picks a randon number greater than 6174
    expect(decodedReplayProtection[1]).to.eq(new BigNumber("0"), "Nonce2");
    expect(deploymentParams.replayProtectionAuthority).to.eq(
      "0x0000000000000000000000000000000000000000",
      "Built-in replay protection"
    );
    expect(deploymentParams.chainId).to.eq(ChainID.MAINNET);

    // All deployments are performed via the proxy account directly.
    const tx = await proxyAccount.deployContract(
      deploymentParams.data,
      deploymentParams.replayProtection,
      deploymentParams.replayProtectionAuthority,
      deploymentParams.signature
    );

    const receipt = await tx.wait(1);

    // Successfully deployed
    expect(receipt.status).to.eq(1);
  }).timeout(50000);
});
