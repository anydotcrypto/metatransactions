import "mocha";
import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
import { solidity, loadFixture } from "ethereum-waffle";
import {
  BigNumber,
  defaultAbiCoder,
  solidityKeccak256,
  getCreate2Address,
} from "ethers/utils";
import {
  ProxyAccountDeployerFactory,
  MsgSenderExampleFactory,
  ProxyAccountFactory,
  ProxyAccountForwarderFactory,
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
import { AddressZero } from "ethers/constants";
import { ProxyAccountForwarder } from "../../src/ts/forwarders/proxyAccountFowarder";
import { MultiSendFactory } from "../../src/typedContracts/MultiSendFactory";
import { MultiSender } from "../../src/ts/multiSend/batchTx";
import { Create2Options } from "ethers/utils/address";

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

  const multiSend = await new MultiSendFactory(admin).deploy();

  const proxyAccountForwarderFactory = new ProxyAccountForwarderFactory();
  const spiedForwarderFactory = spy(proxyAccountForwarderFactory);

  when(
    // @ts-ignore
    spiedForwarderFactory.getProxyAccountDeployerAddress(ChainID.MAINNET)
  ).thenReturn(proxyDeployer.address);

  return {
    proxyDeployer,
    multiSend,
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
      proxyDeployer.address,
      user1,
      new MultiNonceReplayProtection(
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

    const tx = await user1.sendTransaction({
      to: encoded.to,
      data: encoded.data,
    });
    const receipt = await tx.wait(1);

    expect(new BigNumber(encoded.gas).gt(receipt.gasUsed!)).to.be.true;
    const computedProxyAddress = await proxyForwarder.getAddress();
    const proxyAccountContract = new ProxyAccountFactory(user1).attach(
      computedProxyAddress
    );

    const proxyAccountOwner = await proxyAccountContract.owner();
    expect(proxyAccountOwner).to.eq(user1.address);
  }).timeout(50000);

  it("Sign a single meta-transaction with multinonce", async () => {
    const { msgSenderExample, proxyDeployer, admin } = await loadFixture(
      createHubs
    );

    const baseAccount = await proxyDeployer.baseAccount();
    const proxyForwarder = new ProxyAccountForwarder(
      ChainID.MAINNET,
      proxyDeployer.address,
      admin,
      new MultiNonceReplayProtection(
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
      proxyDeployer.address,
      user1,
      new MultiNonceReplayProtection(
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
      to: msgSenderExample.address,
      value: new BigNumber(0),
      data: callData,
    });

    const encoded = await proxyForwarder.encodeSignedMetaTransaction(
      forwardParams
    );

    await proxyDeployer.createProxyAccount(user1.address);
    const saltHex = solidityKeccak256(["address"], [user1.address]);
    const byteCodeHash = solidityKeccak256(
      ["bytes", "bytes20", "bytes"],
      [
        "0x3d602d80600a3d3981f3363d3d373d3d3d363d73",
        baseAccount,
        "0x5af43d82803e903d91602b57fd5bf3",
      ]
    );
    const options: Create2Options = {
      from: proxyDeployer.address,
      salt: saltHex,
      initCodeHash: byteCodeHash,
    };
    const proxyAddress = getCreate2Address(options);

    const tx = user1.sendTransaction({
      to: forwardParams.to,
      data: encoded,
    });

    await expect(tx)
      .to.emit(
        msgSenderExample,
        msgSenderExample.interface.events.WhoIsSender.name
      )
      .withArgs(proxyAddress);
    expect(proxyAddress).eq(forwardParams.to);
  }).timeout(50000);

  it("Sign a single meta-transaction with bitflip", async () => {
    const { msgSenderExample, proxyDeployer, admin } = await loadFixture(
      createHubs
    );

    const baseAccount = await proxyDeployer.baseAccount();

    const proxyForwarder = new ProxyAccountForwarder(
      ChainID.MAINNET,
      proxyDeployer.address,
      admin,
      new BitFlipReplayProtection(
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

  it("Sign multiple meta-transactions with bitflip", async () => {
    const { msgSenderExample, proxyDeployer, user1 } = await loadFixture(
      createHubs
    );

    const baseAccount = await proxyDeployer.baseAccount();
    const proxyForwarder = new ProxyAccountForwarder(
      ChainID.MAINNET,
      proxyDeployer.address,
      user1,
      new BitFlipReplayProtection(
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
          to: msgSenderExample.address,
          value: new BigNumber(i + j),
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
      user1
    );

    const encoded = await forwarder.createProxyContract();
    await admin.sendTransaction({ to: encoded.to, data: encoded.data });

    const baseAccount = await proxyDeployer.baseAccount();
    const saltHex = solidityKeccak256(["address"], [user1.address]);
    const byteCodeHash = solidityKeccak256(
      ["bytes", "bytes20", "bytes"],
      [
        "0x3d602d80600a3d3981f3363d3d373d3d3d363d73",
        baseAccount,
        "0x5af43d82803e903d91602b57fd5bf3",
      ]
    );
    const options: Create2Options = {
      from: proxyDeployer.address,
      salt: saltHex,
      initCodeHash: byteCodeHash,
    };
    const proxyAddress = getCreate2Address(options);

    expect(await forwarder.getAddress()).to.eq(proxyAddress);

    expect(await forwarder.isContractDeployed()).to.be.true;
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
    const baseAccount = await proxyDeployer.baseAccount();
    const saltHex = solidityKeccak256(["address"], [admin.address]);
    const byteCodeHash = solidityKeccak256(
      ["bytes", "bytes20", "bytes"],
      [
        "0x3d602d80600a3d3981f3363d3d373d3d3d363d73",
        baseAccount,
        "0x5af43d82803e903d91602b57fd5bf3",
      ]
    );
    const options: Create2Options = {
      from: proxyDeployer.address,
      salt: saltHex,
      initCodeHash: byteCodeHash,
    };
    const proxyAddress = getCreate2Address(options);

    const proxyAccount = new ProxyAccountFactory(admin).attach(proxyAddress);
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

  it("Deploy a new meta-contract and a meta-tx with MultiSend", async () => {
    const {
      proxyDeployer,
      multiSend,
      admin,
      proxyAccountForwarderFactory,
      msgSenderExample,
    } = await loadFixture(createHubs);

    const forwarder = await proxyAccountForwarderFactory.createNew(
      ChainID.MAINNET,
      ReplayProtectionType.MULTINONCE,
      admin
    );

    const multiSender = new MultiSender(multiSend);

    // Sign meta-deployment
    let encodedProxyDeployTx = await forwarder.createProxyContract();

    // Sign the meta-tx
    const msgSenderExampleData = msgSenderExample.interface.functions.test.encode(
      []
    );
    const forwardParams = await forwarder.signMetaTransaction({
      to: msgSenderExample.address,
      value: new BigNumber("0"),
      data: msgSenderExampleData,
    });

    const encodeForwardData = await forwarder.encodeSignedMetaTransaction(
      forwardParams
    );

    const batch = [
      {
        to: encodedProxyDeployTx.to,
        data: encodedProxyDeployTx.data,
        revertIfFail: false,
      },
      { to: forwardParams.to, data: encodeForwardData, revertIfFail: false },
    ];
    const multiSendEncodedTx = await multiSender.batch(batch);

    const tx = await admin.sendTransaction({
      to: multiSendEncodedTx.to,
      data: multiSendEncodedTx.data,
      gasLimit: 5000000,
    });

    await tx.wait(1);

    const baseAccount = await proxyDeployer.baseAccount();
    const builtProxy = await forwarder.getAddress();
    const saltHex = solidityKeccak256(["address"], [admin.address]);
    const byteCodeHash = solidityKeccak256(
      ["bytes", "bytes20", "bytes"],
      [
        "0x3d602d80600a3d3981f3363d3d373d3d3d363d73",
        baseAccount,
        "0x5af43d82803e903d91602b57fd5bf3",
      ]
    );
    const options = {
      from: proxyDeployer.address,
      salt: saltHex,
      initCodeHash: byteCodeHash,
    };
    const proxyAddress = getCreate2Address(options);
    expect(builtProxy).to.eq(proxyAddress);

    const messageSent = await msgSenderExample.sentTest(builtProxy);
    expect(messageSent).to.be.true;
  }).timeout(50000);
});
