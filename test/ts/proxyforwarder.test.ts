import "mocha";
import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
import { solidity, loadFixture } from "ethereum-waffle";
import { BigNumber, defaultAbiCoder } from "ethers/utils";
import {
  ProxyAccountDeployerFactory,
  ForwarderFactory,
  MsgSenderExampleFactory,
  ProxyAccountFactory,
  MultiNonce,
  BitFlip,
} from "../../src";
import { when, spy } from "ts-mockito";

import { Provider } from "ethers/providers";
import { Wallet } from "ethers/wallet";
import {
  ChainID,
  ForwarderType,
  ReplayProtectionType,
} from "../../src/ts/forwarderfactory";
import { AddressZero } from "ethers/constants";
import { ProxyAccountForwarder } from "../../src/ts/proxyaccountfowarder";

const expect = chai.expect;
chai.use(solidity);
chai.use(chaiAsPromised);

async function createHubs(
  provider: Provider,
  [admin, user1, user2, user3]: Wallet[]
) {
  const proxyHubFactory = new ProxyAccountDeployerFactory(admin);
  const proxyHubCreationTx = proxyHubFactory.getDeployTransaction();

  const proxyHubCreation = await admin.sendTransaction(proxyHubCreationTx);
  const proxyResult = await proxyHubCreation.wait(1);

  const proxyHub = proxyHubFactory.attach(proxyResult.contractAddress!);

  const msgSenderExample = await new MsgSenderExampleFactory(admin).deploy(
    AddressZero
  );

  const spiedForwarderFactory = spy(ForwarderFactory);

  when(
    // @ts-ignore
    spiedForwarderFactory.getForwarderAddress(
      ChainID.MAINNET,
      ForwarderType.PROXYACCOUNTDEPLOYER
    )
  ).thenReturn(proxyHub.address);

  return {
    proxyHub,
    admin,
    user1,
    user2,
    user3,
    msgSenderExample,
  };
}

describe("Proxy Forwarder", () => {
  it("Deploy proxy account and verify the correct address is computed.", async () => {
    const { proxyHub, admin, user1 } = await loadFixture(createHubs);

    const baseAccount = await proxyHub.baseAccount();
    const proxyForwarder = new ProxyAccountForwarder(
      ChainID.MAINNET,
      proxyHub,
      admin,
      new MultiNonce(
        10,
        user1,
        ProxyAccountForwarder.buildCreate2Address(
          proxyHub.address,
          user1.address,
          baseAccount
        )
      )
    );

    const encoded = await proxyForwarder.createProxyContract();

    await user1.sendTransaction({ to: proxyHub.address, data: encoded });

    const proxyAccountAddress = await proxyHub.accounts(admin.address);
    const computedProxyAddress = await proxyForwarder.getProxyAddress();
    expect(computedProxyAddress).to.eq(proxyAccountAddress.toLowerCase());
  }).timeout(50000);

  it("Sign a single meta-transaction with multinonce", async () => {
    const { msgSenderExample, proxyHub, admin } = await loadFixture(createHubs);

    const baseAccount = await proxyHub.baseAccount();
    const proxyForwarder = new ProxyAccountForwarder(
      ChainID.MAINNET,
      proxyHub,
      admin,
      new MultiNonce(
        10,
        admin,
        ProxyAccountForwarder.buildCreate2Address(
          proxyHub.address,
          admin.address,
          baseAccount
        )
      )
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
      new BigNumber("10"),
      "10 coins sent to the proxy hub"
    );
  });

  it("Encode a signed meta-transaction", async () => {
    const { msgSenderExample, proxyHub, user1 } = await loadFixture(createHubs);

    const baseAccount = await proxyHub.baseAccount();

    const noQueues = 10;
    const proxyForwarder = new ProxyAccountForwarder(
      ChainID.MAINNET,
      proxyHub,
      user1,
      new MultiNonce(
        noQueues,
        user1,
        ProxyAccountForwarder.buildCreate2Address(
          proxyHub.address,
          user1.address,
          baseAccount
        )
      )
    );

    const callData = msgSenderExample.interface.functions.test.encode([]);
    const forwardParams = await proxyForwarder.signMetaTransaction({
      target: msgSenderExample.address,
      value: new BigNumber(0),
      callData,
    });

    const encoded = await proxyForwarder.encodeSignedMetaTransaction(
      forwardParams
    );

    await proxyHub.createProxyAccount(user1.address);
    const tx = user1.sendTransaction({
      to: forwardParams.to,
      data: encoded,
    });

    const addr = await proxyHub.accounts(user1.address);

    await expect(tx)
      .to.emit(
        msgSenderExample,
        msgSenderExample.interface.events.WhoIsSender.name
      )
      .withArgs(addr);
    expect(addr.toLowerCase()).to.eq(forwardParams.to.toLowerCase());
  }).timeout(50000);

  it("Sign a single meta-transaction with bitflip", async () => {
    const { msgSenderExample, proxyHub, admin } = await loadFixture(createHubs);

    const baseAccount = await proxyHub.baseAccount();

    const proxyForwarder = new ProxyAccountForwarder(
      ChainID.MAINNET,
      proxyHub,
      admin,
      new BitFlip(
        admin,
        ProxyAccountForwarder.buildCreate2Address(
          proxyHub.address,
          admin.address,
          baseAccount
        )
      )
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

  it("Sign multiple meta-transactions with bitflip", async () => {
    const { msgSenderExample, proxyHub, user1 } = await loadFixture(createHubs);

    const baseAccount = await proxyHub.baseAccount();
    const proxyForwarder = new ProxyAccountForwarder(
      ChainID.MAINNET,
      proxyHub,
      user1,
      new BitFlip(
        user1,
        ProxyAccountForwarder.buildCreate2Address(
          proxyHub.address,
          user1.address,
          baseAccount
        )
      )
    );

    const callData = msgSenderExample.interface.functions.willRevert.encode([]);

    for (let j = 0; j < 10; j++) {
      for (let i = 0; i < 256; i++) {
        const forwardParams = await proxyForwarder.signMetaTransaction({
          target: msgSenderExample.address,
          value: new BigNumber(i + j),
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
        expect(decodedReplayProtection[1]).to.eq(new BigNumber(i), "Nonce2");
        expect(forwardParams.replayProtectionAuthority).to.eq(
          "0x0000000000000000000000000000000000000000",
          "Built-in replay protection"
        );
        expect(forwardParams.signer).to.eq(
          user1.address,
          "Signer address is the admin wallet"
        );
        expect(forwardParams.target).to.eq(
          msgSenderExample.address,
          "Target contract"
        );
        expect(forwardParams.value).to.eq(
          new BigNumber(i + j),
          "Coins sent to the proxy hub"
        );
      }
    }
  }).timeout(500000);

  it("Tries to re-deploy the same proxy contract twice and fails.", async () => {
    const { proxyHub, admin, user1 } = await loadFixture(createHubs);

    const forwarder = await ForwarderFactory.getProxyForwarder(
      ChainID.MAINNET,
      ReplayProtectionType.MULTINONCE,
      admin
    );

    const encoded = await forwarder.createProxyContract();
    await user1.sendTransaction({ to: proxyHub.address, data: encoded });

    const proxyAccountAddress = await proxyHub.accounts(admin.address);

    expect(await forwarder.getProxyAddress()).to.eq(
      proxyAccountAddress.toLowerCase()
    );

    // Try to re-deploy via the contract directly.
    await expect(proxyHub.connect(admin).createProxyAccount(admin.address)).to
      .be.reverted;

    // Try to re-deploy via the library. Caught before sending transaction.
    return expect(
      forwarder.createProxyContract()
    ).to.be.eventually.rejectedWith(
      "ProxyAccount for " + admin.address + " already exists."
    );
  }).timeout(50000);

  it("Deploy a new meta-contract with the ProxyAccountDeployer installed.", async () => {
    const { proxyHub, admin } = await loadFixture(createHubs);

    const forwarder = await ForwarderFactory.getProxyForwarder(
      ChainID.MAINNET,
      ReplayProtectionType.MULTINONCE,
      admin
    );

    const initCode = new MsgSenderExampleFactory(admin).getDeployTransaction(
      proxyHub.address
    ).data! as string;

    const deploymentParams = await forwarder.signMetaDeployment(initCode);

    await proxyHub.connect(admin).createProxyAccount(admin.address);
    const proxyAccountAddress = await proxyHub.accounts(admin.address);
    const proxyAccount = new ProxyAccountFactory(admin).attach(
      proxyAccountAddress
    );
    const decodedReplayProtection = defaultAbiCoder.decode(
      ["uint", "uint"],
      deploymentParams.replayProtection
    );

    expect(deploymentParams.to).to.eq(proxyAccount.address.toLowerCase());
    expect(deploymentParams.signer).to.eq(admin.address);
    expect(deploymentParams.initCode).to.eq(initCode);
    expect(decodedReplayProtection[0]).to.eq(new BigNumber("0")); // Picks a randon number greater than 6174
    expect(decodedReplayProtection[1]).to.eq(new BigNumber("0"), "Nonce2");
    expect(deploymentParams.replayProtectionAuthority).to.eq(
      "0x0000000000000000000000000000000000000000",
      "Built-in replay protection"
    );
    expect(deploymentParams.chainId).to.eq(ChainID.MAINNET);
    const onchainID = await proxyHub.getChainID();
    expect(deploymentParams.chainId).to.eq(onchainID);

    // All deployments are performed via the proxy account directly.
    const tx = await proxyAccount.deployContract(
      deploymentParams.initCode,
      deploymentParams.replayProtection,
      deploymentParams.replayProtectionAuthority,
      deploymentParams.signature
    );

    const receipt = await tx.wait(1);

    // Successfully deployed
    expect(receipt.status).to.eq(1);
  }).timeout(50000);
});
