import "mocha";
import * as chai from "chai";
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
  MultiNonceReplayProtection,
  BitFlipReplayProtection,
  ProxyAccountDeployer,
  deployMetaTxContracts,
  ProxyAccountForwarderFactory,
  EchoFactory,
} from "../../src";

import { Provider } from "ethers/providers";
import { Wallet } from "ethers/wallet";
import {
  ChainID,
  ReplayProtectionType,
} from "../../src/ts/forwarders/forwarderFactory";
import { AddressZero } from "ethers/constants";
import { ProxyAccountForwarder } from "../../src/ts/forwarders/proxyAccountFowarder";
import { Create2Options } from "ethers/utils/address";
import { ethers } from "ethers";
import { flipBit } from "../utils/test-utils";
import { MultiSender } from "../../src/ts/batch/MultiSend";
import { CallType } from "../../src/ts/forwarders/forwarder";

const expect = chai.expect;
chai.use(solidity);

async function createHubs(provider: Provider, [admin, user1]: Wallet[]) {
  const { proxyAccountDeployerAddress } = await deployMetaTxContracts(
    admin,
    true
  );
  const proxyDeployer = new ProxyAccountDeployerFactory(admin).attach(
    proxyAccountDeployerAddress
  );

  const msgSenderExample = await new MsgSenderExampleFactory(admin).deploy(
    AddressZero
  );

  const echo = await new EchoFactory(admin).deploy();

  return {
    proxyDeployer,
    admin,
    user1,
    msgSenderExample,
    echo,
  };
}

describe("Proxy Forwarder", () => {
  it("Deploy proxy account and verify the correct address is computed.", async () => {
    const { proxyDeployer, user1 } = await loadFixture(createHubs);

    const proxyAccountAddress = ProxyAccountForwarder.buildProxyAccountAddress(
      user1.address
    );
    const proxyForwarder = new ProxyAccountForwarder(
      ChainID.MAINNET,
      proxyDeployer.address,
      user1,
      proxyAccountAddress,
      new MultiNonceReplayProtection(10, user1, proxyAccountAddress)
    );

    const encoded = await proxyForwarder.createProxyContract();

    await user1.sendTransaction({
      to: encoded.to,
      data: encoded.data,
    });

    const computedProxyAddress = proxyForwarder.address;
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

    const proxyAccountAddress = ProxyAccountForwarder.buildProxyAccountAddress(
      admin.address
    );
    const proxyForwarder = new ProxyAccountForwarder(
      ChainID.MAINNET,
      proxyDeployer.address,
      admin,
      proxyAccountAddress,
      new MultiNonceReplayProtection(10, admin, proxyAccountAddress)
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
    expect(decodedReplayProtection[0]).to.eq(new BigNumber("0"), "Nonce1");
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
  });

  it("Encode a signed meta-transaction", async () => {
    const { msgSenderExample, proxyDeployer, user1 } = await loadFixture(
      createHubs
    );

    const noQueues = 10;
    const proxyAccountAddress = ProxyAccountForwarder.buildProxyAccountAddress(
      user1.address
    );
    const proxyForwarder = new ProxyAccountForwarder(
      ChainID.MAINNET,
      proxyDeployer.address,
      user1,
      proxyAccountAddress,
      new MultiNonceReplayProtection(noQueues, user1, proxyAccountAddress)
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

    const baseAccount = await proxyDeployer.baseAccount();
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

    const proxyAccountAddress = ProxyAccountForwarder.buildProxyAccountAddress(
      admin.address
    );

    const proxyForwarder = new ProxyAccountForwarder(
      ChainID.MAINNET,
      proxyDeployer.address,
      admin,
      proxyAccountAddress,
      new BitFlipReplayProtection(admin, proxyAccountAddress)
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

  it("Sign multiple meta-transactions with bitflip", async () => {
    const { msgSenderExample, proxyDeployer, user1 } = await loadFixture(
      createHubs
    );

    const proxyAccountAddress = ProxyAccountForwarder.buildProxyAccountAddress(
      user1.address
    );
    const proxyForwarder = new ProxyAccountForwarder(
      ChainID.MAINNET,
      proxyDeployer.address,
      user1,
      proxyAccountAddress,
      new BitFlipReplayProtection(user1, proxyAccountAddress)
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
          proxyForwarder.address,
          "Proxy account address"
        );

        expect(decodedReplayProtection[0].gt(new BigNumber("0"))).to.be.true;
        const bitFlipped = flipBit(new BigNumber("0"), new BigNumber(i));
        expect(decodedReplayProtection[1]).to.eq(bitFlipped, "Nonce2");
        expect(forwardParams.replayProtectionAuthority).to.eq(
          "0x0000000000000000000000000000000000000001",
          "Bitflip replay protection"
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

  const createForwarder = async (
    proxyDeployer: ProxyAccountDeployer,
    user: ethers.Wallet,
    replayProtectionType: ReplayProtectionType
  ) => {
    const proxyAccountAddress = ProxyAccountForwarder.buildProxyAccountAddress(
      user.address
    );
    const replayProtection =
      replayProtectionType === ReplayProtectionType.MULTINONCE
        ? new MultiNonceReplayProtection(30, user, proxyAccountAddress)
        : replayProtectionType === ReplayProtectionType.BITFLIP
        ? new BitFlipReplayProtection(user, proxyAccountAddress)
        : new MultiNonceReplayProtection(1, user, proxyAccountAddress);

    const proxyForwarder = new ProxyAccountForwarder(
      ChainID.MAINNET,
      proxyDeployer.address,
      user,
      proxyAccountAddress,
      replayProtection
    );

    return proxyForwarder;
  };

  it("Deploys proxy contract and then checks proxyAccountForwarder.isProxyContractDeployed().", async () => {
    const { proxyDeployer, admin, user1 } = await loadFixture(createHubs);

    const forwarder = await createForwarder(
      proxyDeployer,
      user1,
      ReplayProtectionType.MULTINONCE
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

    expect(forwarder.address).to.eq(proxyAddress);

    expect(await forwarder.isContractDeployed()).to.be.true;
  }).timeout(50000);

  it("Deploy a new meta-contract with the ProxyAccountDeployer installed.", async () => {
    const { proxyDeployer, admin } = await loadFixture(createHubs);
    const forwarder = await createForwarder(
      proxyDeployer,
      admin,
      ReplayProtectionType.MULTINONCE
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
    expect(decodedReplayProtection[0]).to.eq(new BigNumber("0"));
    expect(decodedReplayProtection[1]).to.eq(new BigNumber("0"), "Nonce2");
    expect(deploymentParams.replayProtectionAuthority).to.eq(
      "0x0000000000000000000000000000000000000000",
      "Nonce replay protection"
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

  it("Deploy the proxy contract and a meta-tx with MultiSend", async () => {
    const { proxyDeployer, admin, user1, msgSenderExample } = await loadFixture(
      createHubs
    );

    const forwarder = await createForwarder(
      proxyDeployer,
      user1,
      ReplayProtectionType.MULTINONCE
    );
    const multiSender = new MultiSender();

    // Double-check the proxy contract is not yet deployed
    expect(await forwarder.isContractDeployed()).to.be.false;

    // Sign meta-deployment
    let deployProxy = await forwarder.createProxyContract();

    // Sign the meta-tx
    const msgSenderExampleData = msgSenderExample.interface.functions.test.encode(
      []
    );

    const metaTx = await forwarder.signAndEncodeMetaTransaction({
      to: msgSenderExample.address,
      value: new BigNumber("0"),
      data: msgSenderExampleData,
    });

    const multiSendEncodedTx = multiSender.batch([
      { ...deployProxy, revertOnFail: false },
      { ...metaTx, revertOnFail: true },
    ]);

    const tx = await admin.sendTransaction({
      to: multiSendEncodedTx.to,
      data: multiSendEncodedTx.data,
      gasLimit: 5000000,
    });

    await tx.wait(1);

    const messageSent = await msgSenderExample.sentTest(forwarder.address);
    expect(messageSent).to.be.true;
  }).timeout(50000);

  it("Proxy contract is already deployed. The deploy proxy contract will fail, but the meta-transaction is still processed using MultiSend.", async () => {
    const { proxyDeployer, admin, user1, msgSenderExample } = await loadFixture(
      createHubs
    );

    const forwarder = await createForwarder(
      proxyDeployer,
      user1,
      ReplayProtectionType.MULTINONCE
    );
    const multiSender = new MultiSender();

    // Deploy proxy contract
    let deployProxy = await forwarder.createProxyContract();

    await admin.sendTransaction({ to: deployProxy.to, data: deployProxy.data });

    // Sign the meta-tx
    const msgSenderExampleData = msgSenderExample.interface.functions.test.encode(
      []
    );

    const metaTx = await forwarder.signAndEncodeMetaTransaction({
      to: msgSenderExample.address,
      value: new BigNumber("0"),
      data: msgSenderExampleData,
    });

    const multiSendEncodedTx = multiSender.batch([
      { ...deployProxy, revertOnFail: false },
      { ...metaTx, revertOnFail: true },
    ]);

    const tx = await admin.sendTransaction({
      to: multiSendEncodedTx.to,
      data: multiSendEncodedTx.data,
      gasLimit: 5000000,
    });

    await tx.wait(1);

    const messageSent = await msgSenderExample.sentTest(forwarder.address);
    expect(messageSent).to.be.true;
  }).timeout(50000);

  it("Sign a single meta-transaction, but omit the value field for the ProxyAccountCallData", async () => {
    const { admin, msgSenderExample } = await loadFixture(createHubs);

    const forwarder = await new ProxyAccountForwarderFactory().createNew(
      ChainID.MAINNET,
      ReplayProtectionType.NONCE,
      admin
    );

    // deploy the proxy contract
    const deployProxy = await forwarder.createProxyContract();
    await admin.sendTransaction({ to: deployProxy.to, data: deployProxy.data });

    // omit the value field
    const callData = msgSenderExample.interface.functions.test.encode([]);
    const forwardParams = await forwarder.signMetaTransaction({
      to: msgSenderExample.address,
      data: callData,
    });
    const txData = await forwarder.encodeSignedMetaTransaction(forwardParams);

    const tx = admin.sendTransaction({
      to: forwardParams.to,
      data: txData,
    });

    await expect(tx)
      .to.emit(
        msgSenderExample,
        msgSenderExample.interface.events.WhoIsSender.name
      )
      .withArgs(forwarder.address);
  });

  it("Send one transaction via delegatecall multisend. setting: bitflip", async () => {
    const { msgSenderExample, proxyDeployer, admin, user1 } = await loadFixture(
      createHubs
    );

    const proxyAccountAddress = ProxyAccountForwarder.buildProxyAccountAddress(
      user1.address
    );
    const forwarder = new ProxyAccountForwarder(
      ChainID.MAINNET,
      proxyDeployer.address,
      user1,
      proxyAccountAddress,
      new BitFlipReplayProtection(user1, proxyAccountAddress)
    );

    // Deploy proxy contract
    let deployProxy = await forwarder.createProxyContract();

    await user1.sendTransaction({ to: deployProxy.to, data: deployProxy.data });

    const callData = msgSenderExample.interface.functions.test.encode([]);

    const multiSender = new MultiSender();

    const batched = multiSender.batch([
      { to: msgSenderExample.address, data: callData, revertOnFail: false },
    ]);

    const minimalTx = await forwarder.signAndEncodeMetaTransaction({
      to: batched.to,
      data: batched.data,
      callType: CallType.DELEGATECALL,
    });

    const tx = admin.sendTransaction({
      to: forwarder.address,
      data: minimalTx.data,
    });

    await expect(tx)
      .to.emit(
        msgSenderExample,
        msgSenderExample.interface.events.WhoIsSender.name
      )
      .withArgs(forwarder.address);
  }).timeout(500000);

  it("Send two transactions via delegatecall multisend. setting: bitflip", async () => {
    const {
      msgSenderExample,
      echo,
      proxyDeployer,
      admin,
      user1,
    } = await loadFixture(createHubs);

    const proxyAccountAddress = ProxyAccountForwarder.buildProxyAccountAddress(
      user1.address
    );
    const forwarder = new ProxyAccountForwarder(
      ChainID.MAINNET,
      proxyDeployer.address,
      user1,
      proxyAccountAddress,
      new BitFlipReplayProtection(user1, proxyAccountAddress)
    );

    // Deploy proxy contract
    let deployProxy = await forwarder.createProxyContract();

    await user1.sendTransaction({ to: deployProxy.to, data: deployProxy.data });

    const callData = msgSenderExample.interface.functions.test.encode([]);
    const echoData = echo.interface.functions.sendMessage.encode(["hello"]);
    const multiSender = new MultiSender();

    const batched = multiSender.batch([
      { to: msgSenderExample.address, data: callData, revertOnFail: false },
      { to: echo.address, data: echoData, revertOnFail: false },
    ]);

    const minimalTx = await forwarder.signAndEncodeMetaTransaction({
      to: batched.to,
      data: batched.data,
      callType: CallType.DELEGATECALL,
    });

    const tx = admin.sendTransaction({
      to: minimalTx.to,
      data: minimalTx.data,
    });

    await expect(tx)
      .to.emit(echo, echo.interface.events.Broadcast.name)
      .withArgs("hello");

    const sentTest = await msgSenderExample.sentTest(forwarder.address);

    expect(sentTest).to.be.true;
  }).timeout(500000);
});
