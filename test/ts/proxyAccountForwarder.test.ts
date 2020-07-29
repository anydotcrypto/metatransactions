import "mocha";
import * as chai from "chai";
import { solidity, loadFixture } from "ethereum-waffle";
import {
  BigNumber,
  defaultAbiCoder,
  solidityKeccak256,
  getCreate2Address,
  keccak256,
  parseEther,
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
  DelegateDeployerFactory,
  MultiSender,
  ChainID,
  ReplayProtectionType,
  ProxyAccountForwarder,
  DELEGATE_DEPLOYER_ADDRESS,
} from "../../src";
import { Provider } from "ethers/providers";
import { Wallet } from "ethers/wallet";
import { AddressZero } from "ethers/constants";
import { Create2Options } from "ethers/utils/address";
import { ethers } from "ethers";

const expect = chai.expect;
chai.use(solidity);

async function createHubs(provider: Provider, [admin, user1]: Wallet[]) {
  const { proxyAccountDeployerAddress } = await deployMetaTxContracts(admin);
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
    provider,
  };
}

describe("Proxy Account Forwarder", () => {
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
    const metaTx = await proxyForwarder.signMetaTransaction({
      to: msgSenderExample.address,
      value: new BigNumber("10"),
      data: callData,
    });

    const forwardParams = proxyForwarder.decodeTx(metaTx.data);

    const decodedReplayProtection = defaultAbiCoder.decode(
      ["uint", "uint"],
      forwardParams._replayProtection
    );
    expect(forwardParams._metaTx.data).to.eq(callData, "Calldata");
    expect(metaTx.to).to.eq(proxyForwarder.address, "Proxy account address");
    expect(decodedReplayProtection[0]).to.eq(new BigNumber("0"), "Nonce1");
    expect(decodedReplayProtection[1]).to.eq(new BigNumber("0"), "Nonce2");
    expect(forwardParams._replayProtectionAuthority).to.eq(
      "0x0000000000000000000000000000000000000000",
      "Multinonce replay protection"
    );
    expect(forwardParams._metaTx.to).to.eq(
      msgSenderExample.address,
      "Target contract"
    );
    expect(forwardParams._metaTx.value).to.eq(
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
    const minimalTx = await proxyForwarder.signMetaTransaction({
      to: msgSenderExample.address,
      value: new BigNumber(0),
      data: callData,
    });

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
      to: minimalTx.to,
      data: minimalTx.data,
    });

    await expect(tx)
      .to.emit(
        msgSenderExample,
        msgSenderExample.interface.events.WhoIsSender.name
      )
      .withArgs(proxyAddress);
    expect(proxyAddress).eq(minimalTx.to);
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

    const metaTx = await proxyForwarder.signMetaTransaction({
      to: msgSenderExample.address,
      value: new BigNumber("10"),
      data: callData,
    });
    const forwardParams = proxyForwarder.decodeTx(metaTx.data);

    const decodedReplayProtection = defaultAbiCoder.decode(
      ["uint", "uint"],
      forwardParams._replayProtection
    );
    expect(forwardParams._metaTx.data).to.eq(callData, "Calldata");
    expect(metaTx.to).to.eq(proxyForwarder.address, "Proxy account address");
    expect(decodedReplayProtection[0].gt(new BigNumber("0"))).to.be.true;
    expect(decodedReplayProtection[1]).to.eq(new BigNumber("1"), "Nonce2");
    expect(forwardParams._replayProtectionAuthority).to.eq(
      "0x0000000000000000000000000000000000000001",
      "Bitflip replay protection"
    );
    expect(forwardParams._metaTx.to).to.eq(
      msgSenderExample.address,
      "Target contract"
    );
    expect(forwardParams._metaTx.value).to.eq(
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
    const bitflip = new BitFlipReplayProtection(user1, proxyAccountAddress);
    const proxyForwarder = new ProxyAccountForwarder(
      ChainID.MAINNET,
      proxyDeployer.address,
      user1,
      proxyAccountAddress,
      bitflip
    );

    const callData = msgSenderExample.interface.functions.willRevert.encode([]);

    for (let j = 0; j < 10; j++) {
      for (let i = 0; i < 256; i++) {
        const metaTx = await proxyForwarder.signMetaTransaction({
          to: msgSenderExample.address,
          value: new BigNumber(i + j),
          data: callData,
        });
        const forwardParams = proxyForwarder.decodeTx(metaTx.data);

        const decodedReplayProtection = defaultAbiCoder.decode(
          ["uint", "uint"],
          forwardParams._replayProtection
        );
        expect(forwardParams._metaTx.data).to.eq(callData, "Calldata");
        expect(metaTx.to).to.eq(
          proxyForwarder.address,
          "Proxy account address"
        );
        expect(decodedReplayProtection[0]).to.eq(bitflip.index);
        expect(decodedReplayProtection[1]).to.eq(new BigNumber(2).pow(i));
        expect(forwardParams._replayProtectionAuthority).to.eq(
          "0x0000000000000000000000000000000000000001",
          "Bitflip replay protection"
        );

        expect(forwardParams._metaTx.to).to.eq(
          msgSenderExample.address,
          "Target contract"
        );
        expect(forwardParams._metaTx.value).to.eq(
          new BigNumber(i + j),
          "10 coins sent to the proxy hub"
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

    const initCode = new MsgSenderExampleFactory(admin).getDeployTransaction(
      proxyDeployer.address
    ).data! as string;

    const extraData = "0x123";
    const metaTx = await forwarder.signMetaTransaction({
      data: initCode,
      value: 0,
      salt: extraData,
    });
    const deploymentParams = forwarder.decodeTx(metaTx.data);
    const decodedReplayProtection = defaultAbiCoder.decode(
      ["uint", "uint"],
      deploymentParams._replayProtection
    );

    expect(metaTx.to).to.eq(proxyAddress);
    expect(deploymentParams._metaTx.to).to.eq(DELEGATE_DEPLOYER_ADDRESS);

    const deployer = new DelegateDeployerFactory(admin).attach(
      DELEGATE_DEPLOYER_ADDRESS
    );
    const data = deployer.interface.functions.deploy.encode([
      initCode,
      0,
      keccak256(extraData),
    ]);

    expect(deploymentParams._metaTx.data).to.eq(data);
    expect(decodedReplayProtection[0]).to.eq(new BigNumber("0"));
    expect(decodedReplayProtection[1]).to.eq(new BigNumber("0"), "Nonce2");
    expect(deploymentParams._replayProtectionAuthority).to.eq(
      "0x0000000000000000000000000000000000000000",
      "Nonce replay protection"
    );

    // All deployments are performed via the proxy account directly.
    const proxyAccount = new ProxyAccountFactory(admin).attach(proxyAddress);
    const tx = await proxyAccount.forward(
      {
        to: deploymentParams._metaTx.to,
        value: deploymentParams._metaTx.value,
        data: deploymentParams._metaTx.data,
        callType: deploymentParams._metaTx.callType,
      },
      deploymentParams._replayProtection,
      deploymentParams._replayProtectionAuthority,
      deploymentParams._signature
    );

    const receipt = await tx.wait(1);

    // Successfully deployed
    expect(receipt.status).to.eq(1);

    // Compute deterministic address
    const msgSenderExampleAddress = forwarder.buildDeployedContractAddress(
      initCode,
      extraData
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

  it("Deploy a new meta-contract with a balance of 1 ETH", async () => {
    const { proxyDeployer, admin, provider } = await loadFixture(createHubs);
    const forwarder = await createForwarder(
      proxyDeployer,
      admin,
      ReplayProtectionType.MULTINONCE
    );

    await proxyDeployer.connect(admin).createProxyAccount(admin.address);

    const initCode = new MsgSenderExampleFactory(admin).getDeployTransaction(
      proxyDeployer.address
    ).data! as string;

    const extraData = "0x123";
    const topup = parseEther("0.5");
    const metaTx = await forwarder.signMetaTransaction({
      data: initCode,
      value: topup,
      salt: extraData,
    });
    const deploymentParams = forwarder.decodeTx(metaTx.data);

    // All deployments are performed via the proxy account directly.
    const proxyAccount = new ProxyAccountFactory(admin).attach(
      forwarder.address
    );

    await admin.sendTransaction({
      to: proxyAccount.address,
      value: parseEther("1"),
    });
    expect(deploymentParams._metaTx.value).to.eq(0);

    await proxyAccount.forward(
      {
        to: deploymentParams._metaTx.to,
        value: deploymentParams._metaTx.value,
        data: deploymentParams._metaTx.data,
        callType: deploymentParams._metaTx.callType,
      },
      deploymentParams._replayProtection,
      deploymentParams._replayProtectionAuthority,
      deploymentParams._signature
    );

    const msgSenderAddress = forwarder.buildDeployedContractAddress(
      initCode,
      extraData
    );

    const balance = await provider.getBalance(msgSenderAddress);

    expect(balance).to.eq(topup);
  }).timeout(50000);

  it("Deploy the same contract twice and catch the revert message.", async () => {
    const { proxyDeployer, admin } = await loadFixture(createHubs);
    const forwarder = await createForwarder(
      proxyDeployer,
      admin,
      ReplayProtectionType.MULTINONCE
    );

    await proxyDeployer.connect(admin).createProxyAccount(admin.address);

    const initCode = new MsgSenderExampleFactory(admin).getDeployTransaction(
      proxyDeployer.address
    ).data! as string;

    const extraData = "0x123";
    const metaTx = await forwarder.signMetaTransaction({
      data: initCode,
      value: 0,
      salt: extraData,
    });
    const deploymentParams = forwarder.decodeTx(metaTx.data);

    // All deployments are performed via the proxy account directly.
    const proxyAccount = new ProxyAccountFactory(admin).attach(
      forwarder.address
    );

    const msgSenderExampleAddress = forwarder.buildDeployedContractAddress(
      initCode,
      extraData
    );
    const tx1 = proxyAccount.forward(
      {
        to: deploymentParams._metaTx.to,
        value: deploymentParams._metaTx.value,
        data: deploymentParams._metaTx.data,
        callType: deploymentParams._metaTx.callType,
      },
      deploymentParams._replayProtection,
      deploymentParams._replayProtectionAuthority,
      deploymentParams._signature
    );

    await tx1;
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

    // Time to redeploy... and it should fail!
    const metaTx2 = await forwarder.signMetaTransaction({
      data: initCode,
      value: 0,
      salt: extraData,
    });

    const deploymentParams2 = forwarder.decodeTx(metaTx2.data);
    const tx2 = proxyAccount.forward(
      {
        to: deploymentParams2._metaTx.to,
        value: deploymentParams2._metaTx.value,
        data: deploymentParams2._metaTx.data,
        callType: deploymentParams2._metaTx.callType,
      },
      deploymentParams2._replayProtection,
      deploymentParams2._replayProtectionAuthority,
      deploymentParams2._signature,
      { gasLimit: 3000000 }
    );

    await expect(tx2)
      .to.emit(proxyAccount, proxyAccount.interface.events.Revert.name)
      .withArgs("CREATE2 failed to deploy.");
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

    const metaTx = await forwarder.signMetaTransaction({
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

    const metaTx = await forwarder.signMetaTransaction({
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
    const minimalTx = await forwarder.signMetaTransaction({
      to: msgSenderExample.address,
      data: callData,
    });
    const tx = admin.sendTransaction({
      to: minimalTx.to,
      data: minimalTx.data,
    });

    await expect(tx)
      .to.emit(
        msgSenderExample,
        msgSenderExample.interface.events.WhoIsSender.name
      )
      .withArgs(forwarder.address);
  });

  it("Send two transactions via call multisend. setting: bitflip", async () => {
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

    const minimalTx = await forwarder.signMetaTransaction([
      {
        to: msgSenderExample.address,
        data: callData,
      },
      { to: echo.address, data: echoData },
    ]);

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
