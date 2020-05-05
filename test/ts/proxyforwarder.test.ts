import "mocha";
import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
import { solidity, loadFixture } from "ethereum-waffle";
import { BigNumber, defaultAbiCoder } from "ethers/utils";
import {
  ProxyAccountDeployerFactory,
  MsgSenderExampleFactory,
  ProxyAccountFactory,
  MultiNonce,
  BitFlip,
  ProxyAccountForwarderFactory,
} from "../../src";
import { when, spy } from "ts-mockito";

import { Provider } from "ethers/providers";
import { Wallet } from "ethers/wallet";
import {
  ChainID,
  ReplayProtectionType,
} from "../../src/ts/forwarders/forwarderfactory";
import { AddressZero } from "ethers/constants";
import { ProxyAccountForwarder } from "../../src/ts/forwarders/proxyaccountfowarder";

const expect = chai.expect;
chai.use(solidity);
chai.use(chaiAsPromised);

async function createHubs(
  provider: Provider,
  [admin, user1, user2, user3]: Wallet[]
) {
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
    AddressZero
  );

  const proxyAccountForwarderFactory = new ProxyAccountForwarderFactory();
  const spiedForwarderFactory = spy(proxyAccountForwarderFactory);

  when(
    // @ts-ignore
    spiedForwarderFactory.getProxyAccountDeployerAddress(ChainID.MAINNET)
  ).thenReturn(proxyDeployer.address);

  return {
    proxyDeployer,
    admin,
    user1,
    user2,
    user3,
    msgSenderExample,
    proxyAccountForwarderFactory,
  };
}

describe("Proxy Forwarder", () => {
  it("Deploy proxy account and verify the correct address is computed.", async () => {
    const { proxyDeployer, admin, user1 } = await loadFixture(createHubs);

    const baseAccount = await proxyDeployer.baseAccount();
    const proxyForwarder = new ProxyAccountForwarder(
      ChainID.MAINNET,
      proxyDeployer,
      admin,
      new MultiNonce(
        10,
        user1,
        ProxyAccountForwarder.buildProxyAccountAddress(
          proxyDeployer.address,
          user1.address,
          baseAccount
        )
      )
    );

    const encoded = await proxyForwarder.createProxyContract();

    await user1.sendTransaction({ to: encoded.to, data: encoded.callData });

    const proxyAccountAddress = await proxyDeployer.accounts(admin.address);
    const computedProxyAddress = await proxyForwarder.getAddress();
    expect(computedProxyAddress).to.eq(proxyAccountAddress);
  }).timeout(50000);

  it("Sign a single meta-transaction with multinonce", async () => {
    const { msgSenderExample, proxyDeployer, admin } = await loadFixture(
      createHubs
    );

    const baseAccount = await proxyDeployer.baseAccount();
    const proxyForwarder = new ProxyAccountForwarder(
      ChainID.MAINNET,
      proxyDeployer,
      admin,
      new MultiNonce(
        10,
        admin,
        ProxyAccountForwarder.buildProxyAccountAddress(
          proxyDeployer.address,
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
      await proxyForwarder.getAddress(),
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
    const { msgSenderExample, proxyDeployer, user1 } = await loadFixture(
      createHubs
    );

    const baseAccount = await proxyDeployer.baseAccount();

    const noQueues = 10;
    const proxyForwarder = new ProxyAccountForwarder(
      ChainID.MAINNET,
      proxyDeployer,
      user1,
      new MultiNonce(
        noQueues,
        user1,
        ProxyAccountForwarder.buildProxyAccountAddress(
          proxyDeployer.address,
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

    await proxyDeployer.createProxyAccount(user1.address);
    const tx = user1.sendTransaction({
      to: forwardParams.to,
      data: encoded,
    });

    const addr = await proxyDeployer.accounts(user1.address);

    await expect(tx)
      .to.emit(
        msgSenderExample,
        msgSenderExample.interface.events.WhoIsSender.name
      )
      .withArgs(addr);
    expect(addr).eq(forwardParams.to);
  }).timeout(50000);

  it("Sign a single meta-transaction with bitflip", async () => {
    const { msgSenderExample, proxyDeployer, admin } = await loadFixture(
      createHubs
    );

    const baseAccount = await proxyDeployer.baseAccount();

    const proxyForwarder = new ProxyAccountForwarder(
      ChainID.MAINNET,
      proxyDeployer,
      admin,
      new BitFlip(
        admin,
        ProxyAccountForwarder.buildProxyAccountAddress(
          proxyDeployer.address,
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

  it("Sign multiple meta-transactions with bitflip", async () => {
    const { msgSenderExample, proxyDeployer, user1 } = await loadFixture(
      createHubs
    );

    const baseAccount = await proxyDeployer.baseAccount();
    const proxyForwarder = new ProxyAccountForwarder(
      ChainID.MAINNET,
      proxyDeployer,
      user1,
      new BitFlip(
        user1,
        ProxyAccountForwarder.buildProxyAccountAddress(
          proxyDeployer.address,
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
          await proxyForwarder.getAddress(),
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

  it("Deploys proxy contract and then checks proxyAccountForwarder.isProxyContractDeployed().", async () => {
    const {
      proxyDeployer,
      admin,
      user1,
      proxyAccountForwarderFactory,
    } = await loadFixture(createHubs);

    const forwarder = await proxyAccountForwarderFactory.createNew(
      ChainID.MAINNET,
      ReplayProtectionType.MULTINONCE,
      admin
    );

    const encoded = await forwarder.createProxyContract();
    await user1.sendTransaction({ to: encoded.to, data: encoded.callData });

    const proxyAccountAddress = await proxyDeployer.accounts(admin.address);

    expect(await forwarder.getAddress()).to.eq(proxyAccountAddress);

    expect(await forwarder.isProxyContractDeployed()).to.be.true;
  }).timeout(50000);

  it("Deploy a new meta-contract with the ProxyAccountDeployer installed.", async () => {
    const {
      proxyDeployer,
      admin,
      proxyAccountForwarderFactory,
    } = await loadFixture(createHubs);

    const forwarder = await proxyAccountForwarderFactory.createNew(
      ChainID.MAINNET,
      ReplayProtectionType.MULTINONCE,
      admin
    );

    const initCode = new MsgSenderExampleFactory(admin).getDeployTransaction(
      proxyDeployer.address
    ).data! as string;

    const deploymentParams = await forwarder.signMetaDeployment(initCode);

    await proxyDeployer.connect(admin).createProxyAccount(admin.address);
    const proxyAccountAddress = await proxyDeployer.accounts(admin.address);
    const proxyAccount = new ProxyAccountFactory(admin).attach(
      proxyAccountAddress
    );
    const decodedReplayProtection = defaultAbiCoder.decode(
      ["uint", "uint"],
      deploymentParams.replayProtection
    );

    expect(deploymentParams.to).to.eq(proxyAccount.address);
    expect(deploymentParams.signer).to.eq(admin.address);
    expect(deploymentParams.initCode).to.eq(initCode);
    expect(decodedReplayProtection[0]).to.eq(new BigNumber("0")); // Picks a randon number greater than 6174
    expect(decodedReplayProtection[1]).to.eq(new BigNumber("0"), "Nonce2");
    expect(deploymentParams.replayProtectionAuthority).to.eq(
      "0x0000000000000000000000000000000000000000",
      "Built-in replay protection"
    );
    expect(deploymentParams.chainId).to.eq(ChainID.MAINNET);
    const onchainID = await proxyDeployer.getChainID();
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
