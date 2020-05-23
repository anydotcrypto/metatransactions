import "mocha";
import * as chai from "chai";
import { loadFixture } from "ethereum-waffle";

import {
  keccak256,
  arrayify,
  defaultAbiCoder,
  BigNumber,
  parseEther,
  solidityKeccak256,
  Interface,
} from "ethers/utils";
import { AddressZero } from "ethers/constants";

import Doppelganger from "ethereum-doppelganger";
import { fnIt } from "@pisa-research/test-utils";
import {
  IReplayProtectionJson,
  ProxyAccountDeployer,
  BitFlipNonceStoreFactory,
  MsgSenderExampleFactory,
  ProxyAccountFactory,
  ProxyAccount,
  ProxyAccountDeployerFactory,
  ChainID,
  ReplayProtectionType,
  ProxyAccountForwarder,
  MultiNonceReplayProtection,
  BitFlipReplayProtection,
  deployMetaTxContracts,
  EchoFactory,
} from "../../src";
import { Provider } from "ethers/providers";
import { Wallet } from "ethers/wallet";
import { ForwardParams, CallType } from "../../src/ts/forwarders/forwarder";
import { Create2Options, getCreate2Address } from "ethers/utils/address";
import { ethers } from "ethers";
import { abi } from "../../src/typedContracts/ProxyAccount.json";
const expect = chai.expect;
let hubClass: ProxyAccountDeployer;
let accountClass: ProxyAccount;

type proxyDeployerFunctions = typeof hubClass.functions;
type accountFunctions = typeof accountClass.functions;

export const constructDigest = (params: ForwardParams) => {
  return arrayify(
    keccak256(
      defaultAbiCoder.encode(
        ["address", "address", "uint", "bytes", "bytes", "address", "uint"],
        [
          params.to,
          params.target,
          params.value,
          params.data,
          params.replayProtection,
          params.replayProtectionAuthority,
          params.chainId,
        ]
      )
    )
  );
};

async function createProxyAccountDeployer(
  provider: Provider,
  [admin, owner, sender]: Wallet[]
) {
  const nonceStoreMock = new Doppelganger(IReplayProtectionJson.interface);
  await nonceStoreMock.deploy(admin);
  await nonceStoreMock.update.returns(true);
  await nonceStoreMock.updateFor.returns(true);

  const bitFlipNonceStoreFactory = new BitFlipNonceStoreFactory(admin);
  const bitFlipNonceStore = await bitFlipNonceStoreFactory.deploy();
  const { proxyAccountDeployerAddress } = await deployMetaTxContracts(
    admin,
    true
  );
  const proxyDeployer = new ProxyAccountDeployerFactory(admin).attach(
    proxyAccountDeployerAddress
  );
  const msgSenderFactory = new MsgSenderExampleFactory(admin);
  const msgSenderCon = await msgSenderFactory.deploy(proxyDeployer.address);
  const echoFactory = new EchoFactory(admin);
  const echoCon = await echoFactory.deploy();
  return {
    provider,
    proxyDeployer,
    admin,
    owner,
    sender,
    msgSenderCon,
    nonceStoreMock,
    bitFlipNonceStore,
    echoCon,
  };
}

describe("ProxyAccountDeployer", () => {
  fnIt<proxyDeployerFunctions>(
    (a) => a.createProxyAccount,
    "create proxy account with deterministic address (and compute offchain deterministic address)",
    async () => {
      const { proxyDeployer, sender } = await loadFixture(
        createProxyAccountDeployer
      );

      await proxyDeployer.connect(sender).createProxyAccount(sender.address);
      const baseAccount = await proxyDeployer.baseAccount();
      const saltHex = solidityKeccak256(["address"], [sender.address]);
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

      const builtAddress = ProxyAccountForwarder.buildProxyAccountAddress(
        sender.address
      );

      // Computed offchain
      expect(proxyAddress).to.eq(builtAddress);
    }
  );

  fnIt<proxyDeployerFunctions>(
    (a) => a.createProxyAccount,
    "cannot re-create the same proxy twice",
    async () => {
      const { proxyDeployer, sender } = await loadFixture(
        createProxyAccountDeployer
      );

      await proxyDeployer.connect(sender).createProxyAccount(sender.address);
      const tx = proxyDeployer
        .connect(sender)
        .createProxyAccount(sender.address);

      await expect(tx).to.be.reverted;
    }
  );

  fnIt<accountFunctions>(
    (a) => a.forward,
    "for proxyAccount emits expected address",
    async () => {
      const { proxyDeployer, owner, sender, msgSenderCon } = await loadFixture(
        createProxyAccountDeployer
      );
      const msgSenderCall = msgSenderCon.interface.functions.test.encode([]);

      await proxyDeployer.connect(sender).createProxyAccount(owner.address);
      const baseAccount = await proxyDeployer.baseAccount();
      const saltHex = solidityKeccak256(["address"], [owner.address]);
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

      const proxyAccountFactory = new ProxyAccountFactory(owner);
      const proxyAccount = proxyAccountFactory.attach(proxyAddress);
      const forwarder = await createForwarder(
        proxyDeployer,
        owner,
        ReplayProtectionType.MULTINONCE
      );

      const params = await forwarder.signMetaTransaction({
        to: msgSenderCon.address,
        value: new BigNumber("0"),
        data: msgSenderCall,
      });

      const tx = proxyAccount
        .connect(sender)
        .forward(
          params.target,
          params.value,
          params.data,
          params.replayProtection,
          params.replayProtectionAuthority,
          params.signature
        );

      await expect(tx)
        .to.emit(msgSenderCon, msgSenderCon.interface.events.WhoIsSender.name)
        .withArgs(proxyAddress);
    }
  );

  fnIt<accountFunctions>(
    (a) => a.forward,
    "looks up proxy account address and forwards the call.",
    async () => {
      const { proxyDeployer, owner, sender, msgSenderCon } = await loadFixture(
        createProxyAccountDeployer
      );

      const msgSenderCall = msgSenderCon.interface.functions.test.encode([]);
      const forwarder = await createForwarder(
        proxyDeployer,
        owner,
        ReplayProtectionType.MULTINONCE
      );

      await proxyDeployer.connect(sender).createProxyAccount(owner.address);
      const params = await forwarder.signMetaTransaction({
        to: msgSenderCon.address,
        value: new BigNumber("0"),
        data: msgSenderCall,
      });

      const tx = sender.sendTransaction({
        to: params.to,
        // @ts-ignore
        data: await forwarder.encodeSignedMetaTransaction(params),
      });

      await expect(tx).to.emit(
        msgSenderCon,
        msgSenderCon.interface.events.WhoIsSender.name
      );
    }
  );

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

  fnIt<accountFunctions>(
    (a) => a.forward,
    "sends a transaction using MULTINONCE and it is successful",
    async () => {
      const { proxyDeployer, owner, sender, msgSenderCon } = await loadFixture(
        createProxyAccountDeployer
      );
      const msgSenderCall = msgSenderCon.interface.functions.test.encode([]);
      const forwarder = await createForwarder(
        proxyDeployer,
        owner,
        ReplayProtectionType.MULTINONCE
      );

      await proxyDeployer.connect(sender).createProxyAccount(owner.address);
      const baseAccount = await proxyDeployer.baseAccount();
      const saltHex = solidityKeccak256(["address"], [owner.address]);
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
      const params = await forwarder.signMetaTransaction({
        to: msgSenderCon.address,
        value: new BigNumber("0"),
        data: msgSenderCall,
      });

      const tx = sender.sendTransaction({
        to: proxyAddress,
        gasLimit: 500000,
        gasPrice: parseEther("0.000001"),
        // @ts-ignore
        data: await forwarder.encodeSignedMetaTransaction(params),
      });

      await expect(tx)
        .to.emit(msgSenderCon, msgSenderCon.interface.events.WhoIsSender.name)
        .withArgs(proxyAddress);
    }
  );

  fnIt<accountFunctions>(
    (a) => a.forward,
    "sends two transactions and both revert. We catch the empty revert message and the long revert message.",
    async () => {
      const { proxyDeployer, owner, sender, msgSenderCon } = await loadFixture(
        createProxyAccountDeployer
      );
      const forwarder = await createForwarder(
        proxyDeployer,
        owner,
        ReplayProtectionType.MULTINONCE
      );

      await proxyDeployer.connect(sender).createProxyAccount(owner.address);
      const baseAccount = await proxyDeployer.baseAccount();
      const saltHex = solidityKeccak256(["address"], [owner.address]);
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
      const proxyAccount = new ProxyAccountFactory(sender).attach(proxyAddress);

      const revertNoMessageCallData = msgSenderCon.interface.functions.willRevertNoMessage.encode(
        []
      );

      const minimalTxNoMessage = await forwarder.signAndEncodeMetaTransaction({
        to: msgSenderCon.address,
        data: revertNoMessageCallData,
      });

      const tx1 = sender.sendTransaction({
        to: minimalTxNoMessage.to,
        data: minimalTxNoMessage.data,
      });

      await expect(tx1)
        .to.emit(proxyAccount, proxyAccount.interface.events.Revert.name)
        .withArgs("Transaction reverted silently");

      const revertCallDataLongMessage = msgSenderCon.interface.functions.willRevertLongMessage.encode(
        []
      );

      const minimalTxWithMessage = await forwarder.signAndEncodeMetaTransaction(
        {
          to: msgSenderCon.address,
          data: revertCallDataLongMessage,
        }
      );

      const tx2 = sender.sendTransaction({
        to: minimalTxWithMessage.to,
        data: minimalTxWithMessage.data,
      });

      await expect(tx2)
        .to.emit(proxyAccount, proxyAccount.interface.events.Revert.name)
        .withArgs(
          "This is a really long revert message to make sure we can catch it. There are no hidden quirks by solidity."
        );
    }
  );

  fnIt<accountFunctions>(
    (a) => a.forward,
    "the forwarded transaction fails and we decode the revert message that was emitted.",
    async () => {
      const { proxyDeployer, owner, sender, msgSenderCon } = await loadFixture(
        createProxyAccountDeployer
      );
      const forwarder = await createForwarder(
        proxyDeployer,
        owner,
        ReplayProtectionType.MULTINONCE
      );

      await proxyDeployer.connect(sender).createProxyAccount(owner.address);
      const baseAccount = await proxyDeployer.baseAccount();
      const saltHex = solidityKeccak256(["address"], [owner.address]);
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
      const proxyAccount = new ProxyAccountFactory(sender).attach(proxyAddress);

      const revertCallDataLongMessage = msgSenderCon.interface.functions.willRevertLongMessage.encode(
        []
      );

      const minimalTxWithMessage = await forwarder.signAndEncodeMetaTransaction(
        {
          to: msgSenderCon.address,
          data: revertCallDataLongMessage,
        }
      );

      const tx = sender.sendTransaction({
        to: minimalTxWithMessage.to,
        data: minimalTxWithMessage.data,
      });

      await expect(tx)
        .to.emit(proxyAccount, proxyAccount.interface.events.Revert.name)
        .withArgs(
          "This is a really long revert message to make sure we can catch it. There are no hidden quirks by solidity."
        );
    }
  );

  fnIt<accountFunctions>(
    (a) => a.forward,
    "sends several transactions, but the first forward fails. All subsequent transactions should still pass.",
    async () => {
      const { proxyDeployer, owner, sender, msgSenderCon } = await loadFixture(
        createProxyAccountDeployer
      );
      const msgSenderCall = msgSenderCon.interface.functions.test.encode([]);
      const forwarder = await createForwarder(
        proxyDeployer,
        owner,
        ReplayProtectionType.MULTINONCE
      );

      await proxyDeployer.connect(sender).createProxyAccount(owner.address);
      const baseAccount = await proxyDeployer.baseAccount();
      const saltHex = solidityKeccak256(["address"], [owner.address]);
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
      const proxyAccount = new ProxyAccountFactory(sender).attach(proxyAddress);

      const revertNoMessageCallData = msgSenderCon.interface.functions.willRevertNoMessage.encode(
        []
      );

      const minimalTxNoMessage = await forwarder.signAndEncodeMetaTransaction({
        to: msgSenderCon.address,
        data: revertNoMessageCallData,
      });

      const tx1 = sender.sendTransaction({
        to: minimalTxNoMessage.to,
        data: minimalTxNoMessage.data,
      });

      await expect(tx1)
        .to.emit(proxyAccount, proxyAccount.interface.events.Revert.name)
        .withArgs("Transaction reverted silently");

      for (let i = 0; i < 10; i++) {
        const params = await forwarder.signMetaTransaction({
          to: msgSenderCon.address,
          value: new BigNumber("0"),
          data: msgSenderCall,
        });

        const tx = sender.sendTransaction({
          to: proxyAddress,
          gasLimit: 500000,
          gasPrice: parseEther("0.000001"),
          // @ts-ignore
          data: await forwarder.encodeSignedMetaTransaction(params),
        });

        await expect(tx)
          .to.emit(msgSenderCon, msgSenderCon.interface.events.WhoIsSender.name)
          .withArgs(proxyAddress);
      }
    }
  );

  fnIt<accountFunctions>(
    (a) => a.forward,
    "empty signature will emit a pseudo-random signer",
    async () => {
      const { proxyDeployer, owner, sender, msgSenderCon } = await loadFixture(
        createProxyAccountDeployer
      );

      const msgSenderCall = msgSenderCon.interface.functions.test.encode([]);
      const forwarder = await createForwarder(
        proxyDeployer,
        owner,
        ReplayProtectionType.MULTINONCE
      );

      await proxyDeployer.connect(sender).createProxyAccount(owner.address);

      // Replay protection is always reset due to fixture. So it should be [0.0].
      const params = await forwarder.signMetaTransaction({
        to: msgSenderCon.address,
        value: new BigNumber("0"),
        data: msgSenderCall,
      });

      const proxyAccount = new ProxyAccountFactory(owner).attach(
        forwarder.address
      );

      const tx = proxyAccount
        .connect(sender)
        .forward(
          params.target,
          params.value,
          params.data,
          params.replayProtection,
          params.replayProtectionAuthority,
          "0x0000000000000000000000000000000000000000"
        );

      await expect(tx).to.revertedWith(
        "Owner did not sign this meta-transaction."
      );
    }
  );
  fnIt<accountFunctions>(
    (a) => a.forward,
    "set Calltype.DELEGATE, but invoke forward. It should not recognise the signature.",
    async () => {
      const { proxyDeployer, owner, sender, msgSenderCon } = await loadFixture(
        createProxyAccountDeployer
      );
      const msgSenderCall = msgSenderCon.interface.functions.test.encode([]);
      const forwarder = await createForwarder(
        proxyDeployer,
        owner,
        ReplayProtectionType.MULTINONCE
      );

      await proxyDeployer.connect(sender).createProxyAccount(owner.address);
      const params = await forwarder.signMetaTransaction({
        to: msgSenderCon.address,
        value: new BigNumber("0"),
        data: msgSenderCall,
      });

      params.callType = CallType.DELEGATE;

      const tx = sender.sendTransaction({
        to: forwarder.address,
        // @ts-ignore
        data: await forwarder.encodeSignedMetaTransaction(params),
      });

      await expect(tx).to.be.revertedWith(
        "Owner did not sign this meta-transaction."
      );
    }
  );

  fnIt<accountFunctions>(
    (a) => a.delegate,
    "deploys a contract via the proxy account",
    async () => {
      const { proxyDeployer, owner, sender } = await loadFixture(
        createProxyAccountDeployer
      );

      const msgSenderFactory = new MsgSenderExampleFactory(owner);

      await proxyDeployer.connect(sender).createProxyAccount(owner.address);

      const forwarder = await createForwarder(
        proxyDeployer,
        owner,
        ReplayProtectionType.MULTINONCE
      );

      const proxyAccount = new ProxyAccountFactory(sender).attach(
        forwarder.address
      );

      // Deploy the proxy using CREATE2
      const initCode = msgSenderFactory.getDeployTransaction(
        proxyDeployer.address
      ).data! as string;

      const params = await forwarder.signMetaDeployment(initCode, "0x123");

      await proxyAccount
        .connect(sender)
        .delegate(
          params.target,
          params.value,
          params.data,
          params.replayProtection,
          params.replayProtectionAuthority,
          params.signature
        );

      const msgSenderExampleAddress = getCreate2Address({
        from: forwarder.address,
        salt: keccak256("0x123"),
        initCode: initCode,
      });

      const msgSenderExampleCon = msgSenderFactory.attach(
        msgSenderExampleAddress
      );

      // Try executing a function - it should exist and work
      const tx = msgSenderExampleCon.connect(sender).test();
      await expect(tx)
        .to.emit(
          msgSenderExampleCon,
          msgSenderExampleCon.interface.events.WhoIsSender.name
        )
        .withArgs(sender.address);
    }
  );

  fnIt<accountFunctions>(
    (a) => a.delegate,
    "deploys an encoded metadeployment via a proxy account",
    async () => {
      const { proxyDeployer, owner, sender } = await loadFixture(
        createProxyAccountDeployer
      );

      const msgSenderFactory = new MsgSenderExampleFactory(owner);

      await proxyDeployer.connect(sender).createProxyAccount(owner.address);

      const forwarder = await createForwarder(
        proxyDeployer,
        owner,
        ReplayProtectionType.MULTINONCE
      );

      const initCode = msgSenderFactory.getDeployTransaction(
        proxyDeployer.address
      ).data! as string;

      // Deploy the proxy using CREATE2
      const params = await forwarder.signMetaDeployment(initCode, "0x123");

      // @ts-ignore
      const encodedMetaDeployment = await forwarder.encodeSignedMetaTransaction(
        params
      );
      await sender.sendTransaction({
        to: params.to,
        data: encodedMetaDeployment,
      });

      const msgSenderExampleAddress = getCreate2Address({
        from: forwarder.address,
        salt: keccak256("0x123"),
        initCode: initCode,
      });

      // Fetch the proxy on-chain instance
      const msgSenderExampleCon = msgSenderFactory.attach(
        msgSenderExampleAddress
      );

      // Try executing a function - it should exist and work
      const tx = msgSenderExampleCon.connect(sender).test();
      await expect(tx)
        .to.emit(
          msgSenderExampleCon,
          msgSenderExampleCon.interface.events.WhoIsSender.name
        )
        .withArgs(sender.address);
    }
  );

  fnIt<accountFunctions>(
    (a) => a.delegate,
    "into a contract's function that reverts. We should catch the revert message.",
    async () => {
      const { proxyDeployer, owner, sender, msgSenderCon } = await loadFixture(
        createProxyAccountDeployer
      );

      await proxyDeployer.connect(sender).createProxyAccount(owner.address);

      const forwarder = await createForwarder(
        proxyDeployer,
        owner,
        ReplayProtectionType.MULTINONCE
      );

      const revertCallDataLongMessage = msgSenderCon.interface.functions.willRevertLongMessage.encode(
        []
      );

      // Deploy the proxy using CREATE2
      const encodedData = await forwarder.signAndEncodeMetaTransaction({
        to: msgSenderCon.address,
        data: revertCallDataLongMessage,
        callType: CallType.DELEGATE,
      });

      const proxyAccount = new ProxyAccountFactory(owner).attach(
        forwarder.address
      );

      const tx = sender.sendTransaction({
        to: encodedData.to,
        data: encodedData.data,
      });

      await expect(tx)
        .to.emit(proxyAccount, proxyAccount.interface.events.Revert.name)
        .withArgs(
          "This is a really long revert message to make sure we can catch it. There are no hidden quirks by solidity."
        );
    }
  );

  fnIt<accountFunctions>(
    (a) => a.delegate,
    "send the same meta-transaction twice and it should fail.",
    async () => {
      const { proxyDeployer, owner, sender, msgSenderCon } = await loadFixture(
        createProxyAccountDeployer
      );

      await proxyDeployer.connect(sender).createProxyAccount(owner.address);

      const forwarder = await createForwarder(
        proxyDeployer,
        owner,
        ReplayProtectionType.MULTINONCE
      );

      const callData = msgSenderCon.interface.functions.test.encode([]);

      // Deploy the proxy using CREATE2
      const encodedData = await forwarder.signAndEncodeMetaTransaction({
        to: msgSenderCon.address,
        data: callData,
        callType: CallType.DELEGATE,
      });

      const tx1 = sender.sendTransaction({
        to: encodedData.to,
        data: encodedData.data,
      });

      await expect(tx1)
        .to.emit(msgSenderCon, msgSenderCon.interface.events.WhoIsSender.name)
        .withArgs(sender.address);

      const tx2 = sender.sendTransaction({
        to: encodedData.to,
        data: encodedData.data,
      });

      await expect(tx2).to.be.revertedWith(
        "Multinonce replay protection failed"
      );
    }
  );

  fnIt<accountFunctions>(
    (a) => a.delegate,
    "set CallType.CALL, but invoke delegate. It should not recognise the signature.",
    async () => {
      const { proxyDeployer, owner, sender, msgSenderCon } = await loadFixture(
        createProxyAccountDeployer
      );

      await proxyDeployer.connect(sender).createProxyAccount(owner.address);

      const forwarder = await createForwarder(
        proxyDeployer,
        owner,
        ReplayProtectionType.MULTINONCE
      );

      const testData = msgSenderCon.interface.functions.test.encode([]);

      // Deploy the proxy using CREATE2
      const params = await forwarder.signMetaTransaction({
        to: msgSenderCon.address,
        data: testData,
      });

      params.callType = CallType.DELEGATE;
      // @ts-ignore
      const encodedData = await forwarder.encodeSignedMetaTransaction(params);

      const tx = sender.sendTransaction({
        to: params.to,
        data: encodedData,
      });

      await expect(tx).to.be.revertedWith(
        "Owner did not sign this meta-transaction."
      );
    }
  );

  fnIt<accountFunctions>(
    (a) => a.batch,
    "Send one transaction via the batch. It should succeed.",
    async () => {
      const { msgSenderCon, proxyDeployer, admin } = await loadFixture(
        createProxyAccountDeployer
      );

      const proxyAccountAddress = ProxyAccountForwarder.buildProxyAccountAddress(
        admin.address
      );
      const forwarder = new ProxyAccountForwarder(
        ChainID.MAINNET,
        proxyDeployer.address,
        admin,
        proxyAccountAddress,
        new BitFlipReplayProtection(admin, proxyAccountAddress)
      );

      // Deploy proxy contract
      let deployProxy = await forwarder.createProxyContract();

      await admin.sendTransaction({
        to: deployProxy.to,
        data: deployProxy.data,
      });

      const callData = msgSenderCon.interface.functions.test.encode([]);

      const to = [msgSenderCon.address];
      const value = [0];
      const data = [callData];
      const revertOnFail = [false];
      const typeOfCall = [CallType.CALL];

      const replayProtection = defaultAbiCoder.encode(["uint", "uint"], [0, 0]);
      const encodedCallData = defaultAbiCoder.encode(
        ["uint", "address[]", "uint[]", "bytes[]", "bool[]", "uint[]"],
        [CallType.BATCH, to, value, data, revertOnFail, typeOfCall]
      );

      // @ts-ignore
      const encodedMetaTx = forwarder.encodeMetaTransactionToSign(
        encodedCallData,
        replayProtection,
        AddressZero
      );

      const signature = await admin.signMessage(
        arrayify(keccak256(encodedMetaTx))
      );

      const proxyAccountInterface = new Interface(
        abi
      ) as ProxyAccount["interface"];

      const encodedBatch = proxyAccountInterface.functions.batch.encode([
        to,
        value,
        data,
        revertOnFail,
        typeOfCall,
        replayProtection,
        AddressZero,
        signature,
      ]);

      const tx = admin.sendTransaction({
        to: forwarder.address,
        data: encodedBatch,
      });

      await expect(tx)
        .to.emit(msgSenderCon, msgSenderCon.interface.events.WhoIsSender.name)
        .withArgs(forwarder.address);
    }
  ).timeout(500000);

  fnIt<accountFunctions>(
    (a) => a.batch,
    "Send a reverting transaction via the batch with revertOnFail=false. We should find a revert message.",
    async () => {
      const { msgSenderCon, proxyDeployer, admin } = await loadFixture(
        createProxyAccountDeployer
      );

      const proxyAccountAddress = ProxyAccountForwarder.buildProxyAccountAddress(
        admin.address
      );
      const forwarder = new ProxyAccountForwarder(
        ChainID.MAINNET,
        proxyDeployer.address,
        admin,
        proxyAccountAddress,
        new BitFlipReplayProtection(admin, proxyAccountAddress)
      );

      // Deploy proxy contract
      let deployProxy = await forwarder.createProxyContract();

      await admin.sendTransaction({
        to: deployProxy.to,
        data: deployProxy.data,
      });

      const callData = msgSenderCon.interface.functions.willRevertLongMessage.encode(
        []
      );

      const to = [msgSenderCon.address];
      const value = [0];
      const data = [callData];
      const revertOnFail = [false];
      const typeOfCall = [CallType.CALL];

      const replayProtection = defaultAbiCoder.encode(["uint", "uint"], [0, 0]);
      const encodedCallData = defaultAbiCoder.encode(
        ["uint", "address[]", "uint[]", "bytes[]", "bool[]", "uint[]"],
        [CallType.BATCH, to, value, data, revertOnFail, typeOfCall]
      );

      // @ts-ignore
      const encodedMetaTx = forwarder.encodeMetaTransactionToSign(
        encodedCallData,
        replayProtection,
        AddressZero
      );

      const signature = await admin.signMessage(
        arrayify(keccak256(encodedMetaTx))
      );

      const proxyAccountInterface = new Interface(
        abi
      ) as ProxyAccount["interface"];

      const encodedBatch = proxyAccountInterface.functions.batch.encode([
        to,
        value,
        data,
        revertOnFail,
        typeOfCall,
        replayProtection,
        AddressZero,
        signature,
      ]);

      const proxyAccount = new ProxyAccountFactory(admin).attach(
        forwarder.address
      );
      const tx = admin.sendTransaction({
        to: forwarder.address,
        data: encodedBatch,
      });

      await expect(tx)
        .to.emit(proxyAccount, proxyAccount.interface.events.Revert.name)
        .withArgs(
          "This is a really long revert message to make sure we can catch it. There are no hidden quirks by solidity."
        );
    }
  ).timeout(500000);

  fnIt<accountFunctions>(
    (a) => a.batch,
    "Send a reverting transaction via the batch with revertOnFail=true. The Ethereum transaction should revert. ",
    async () => {
      const { msgSenderCon, proxyDeployer, admin } = await loadFixture(
        createProxyAccountDeployer
      );

      const proxyAccountAddress = ProxyAccountForwarder.buildProxyAccountAddress(
        admin.address
      );
      const forwarder = new ProxyAccountForwarder(
        ChainID.MAINNET,
        proxyDeployer.address,
        admin,
        proxyAccountAddress,
        new BitFlipReplayProtection(admin, proxyAccountAddress)
      );

      // Deploy proxy contract
      let deployProxy = await forwarder.createProxyContract();

      await admin.sendTransaction({
        to: deployProxy.to,
        data: deployProxy.data,
      });

      const callData = msgSenderCon.interface.functions.willRevertLongMessage.encode(
        []
      );

      const to = [msgSenderCon.address];
      const value = [0];
      const data = [callData];
      const revertOnFail = [true];
      const typeOfCall = [CallType.CALL];

      const replayProtection = defaultAbiCoder.encode(["uint", "uint"], [0, 0]);
      const encodedCallData = defaultAbiCoder.encode(
        ["uint", "address[]", "uint[]", "bytes[]", "bool[]", "uint[]"],
        [CallType.BATCH, to, value, data, revertOnFail, typeOfCall]
      );

      // @ts-ignore
      const encodedMetaTx = forwarder.encodeMetaTransactionToSign(
        encodedCallData,
        replayProtection,
        AddressZero
      );

      const signature = await admin.signMessage(
        arrayify(keccak256(encodedMetaTx))
      );

      const proxyAccountInterface = new Interface(
        abi
      ) as ProxyAccount["interface"];

      const encodedBatch = proxyAccountInterface.functions.batch.encode([
        to,
        value,
        data,
        revertOnFail,
        typeOfCall,
        replayProtection,
        AddressZero,
        signature,
      ]);

      const tx = admin.sendTransaction({
        to: forwarder.address,
        data: encodedBatch,
      });

      await expect(tx).to.be.revertedWith("Transaction reverted.");
    }
  ).timeout(500000);

  fnIt<accountFunctions>(
    (a) => a.batch,
    "Send two transactions via the batch. Both have calltype as CALL. It should pass.",
    async () => {
      const { msgSenderCon, proxyDeployer, admin, echoCon } = await loadFixture(
        createProxyAccountDeployer
      );

      const proxyAccountAddress = ProxyAccountForwarder.buildProxyAccountAddress(
        admin.address
      );
      const forwarder = new ProxyAccountForwarder(
        ChainID.MAINNET,
        proxyDeployer.address,
        admin,
        proxyAccountAddress,
        new BitFlipReplayProtection(admin, proxyAccountAddress)
      );

      // Deploy proxy contract
      let deployProxy = await forwarder.createProxyContract();

      await admin.sendTransaction({
        to: deployProxy.to,
        data: deployProxy.data,
      });

      const echoData = echoCon.interface.functions.sendMessage.encode([
        "hello",
      ]);
      const callData = msgSenderCon.interface.functions.test.encode([]);

      const to = [msgSenderCon.address, echoCon.address];
      const value = [0, 0];
      const data = [callData, echoData];
      const revertOnFail = [true, true];
      const typeOfCall = [CallType.CALL, CallType.CALL];

      const replayProtection = defaultAbiCoder.encode(["uint", "uint"], [0, 0]);
      const encodedCallData = defaultAbiCoder.encode(
        ["uint", "address[]", "uint[]", "bytes[]", "bool[]", "uint[]"],
        [CallType.BATCH, to, value, data, revertOnFail, typeOfCall]
      );

      // @ts-ignore
      const encodedMetaTx = forwarder.encodeMetaTransactionToSign(
        encodedCallData,
        replayProtection,
        AddressZero
      );

      const signature = await admin.signMessage(
        arrayify(keccak256(encodedMetaTx))
      );

      const proxyAccountInterface = new Interface(
        abi
      ) as ProxyAccount["interface"];

      const encodedBatch = proxyAccountInterface.functions.batch.encode([
        to,
        value,
        data,
        revertOnFail,
        typeOfCall,
        replayProtection,
        AddressZero,
        signature,
      ]);

      const tx = admin.sendTransaction({
        to: forwarder.address,
        data: encodedBatch,
      });

      await expect(tx)
        .to.emit(msgSenderCon, msgSenderCon.interface.events.WhoIsSender.name)
        .withArgs(forwarder.address);

      const lastMessage = await echoCon.lastMessage();
      expect(lastMessage).to.eq("hello");
    }
  ).timeout(500000);

  fnIt<accountFunctions>(
    (a) => a.batch,
    "Send two transactions via the batch. One CALL and one DELEGATE. It should pass.",
    async () => {
      const { msgSenderCon, proxyDeployer, admin, echoCon } = await loadFixture(
        createProxyAccountDeployer
      );

      const proxyAccountAddress = ProxyAccountForwarder.buildProxyAccountAddress(
        admin.address
      );
      const forwarder = new ProxyAccountForwarder(
        ChainID.MAINNET,
        proxyDeployer.address,
        admin,
        proxyAccountAddress,
        new BitFlipReplayProtection(admin, proxyAccountAddress)
      );

      // Deploy proxy contract
      let deployProxy = await forwarder.createProxyContract();

      await admin.sendTransaction({
        to: deployProxy.to,
        data: deployProxy.data,
      });

      const echoData = echoCon.interface.functions.sendMessage.encode([
        "hello",
      ]);
      const callData = msgSenderCon.interface.functions.test.encode([]);

      const to = [msgSenderCon.address, echoCon.address];
      const value = [0, 0];
      const data = [callData, echoData];
      const revertOnFail = [true, true];
      const typeOfCall = [CallType.DELEGATE, CallType.CALL];

      const replayProtection = defaultAbiCoder.encode(["uint", "uint"], [0, 0]);
      const encodedCallData = defaultAbiCoder.encode(
        ["uint", "address[]", "uint[]", "bytes[]", "bool[]", "uint[]"],
        [CallType.BATCH, to, value, data, revertOnFail, typeOfCall]
      );

      // @ts-ignore
      const encodedMetaTx = forwarder.encodeMetaTransactionToSign(
        encodedCallData,
        replayProtection,
        AddressZero
      );

      const signature = await admin.signMessage(
        arrayify(keccak256(encodedMetaTx))
      );

      const proxyAccountInterface = new Interface(
        abi
      ) as ProxyAccount["interface"];

      const encodedBatch = proxyAccountInterface.functions.batch.encode([
        to,
        value,
        data,
        revertOnFail,
        typeOfCall,
        replayProtection,
        AddressZero,
        signature,
      ]);

      const tx = admin.sendTransaction({
        to: forwarder.address,
        data: encodedBatch,
      });

      await expect(tx)
        .to.emit(msgSenderCon, msgSenderCon.interface.events.WhoIsSender.name)
        .withArgs(admin.address);

      const lastMessage = await echoCon.lastMessage();
      expect(lastMessage).to.eq("hello");
    }
  ).timeout(500000);

  fnIt<accountFunctions>(
    (a) => a.batch,
    "to has an extra to entry. It should fail.",
    async () => {
      const { msgSenderCon, proxyDeployer, admin, echoCon } = await loadFixture(
        createProxyAccountDeployer
      );

      const proxyAccountAddress = ProxyAccountForwarder.buildProxyAccountAddress(
        admin.address
      );
      const forwarder = new ProxyAccountForwarder(
        ChainID.MAINNET,
        proxyDeployer.address,
        admin,
        proxyAccountAddress,
        new BitFlipReplayProtection(admin, proxyAccountAddress)
      );

      // Deploy proxy contract
      let deployProxy = await forwarder.createProxyContract();

      await admin.sendTransaction({
        to: deployProxy.to,
        data: deployProxy.data,
      });

      const echoData = echoCon.interface.functions.sendMessage.encode([
        "hello",
      ]);
      const callData = msgSenderCon.interface.functions.test.encode([]);

      const to = [msgSenderCon.address, echoCon.address, msgSenderCon.address];
      const value = [0, 0];
      const data = [callData, echoData];
      const revertOnFail = [true, true];
      const typeOfCall = [CallType.CALL, CallType.CALL];

      const replayProtection = defaultAbiCoder.encode(["uint", "uint"], [0, 0]);
      const encodedCallData = defaultAbiCoder.encode(
        ["uint", "address[]", "uint[]", "bytes[]", "bool[]", "uint[]"],
        [CallType.BATCH, to, value, data, revertOnFail, typeOfCall]
      );

      // @ts-ignore
      const encodedMetaTx = forwarder.encodeMetaTransactionToSign(
        encodedCallData,
        replayProtection,
        AddressZero
      );

      const signature = await admin.signMessage(
        arrayify(keccak256(encodedMetaTx))
      );

      const proxyAccountInterface = new Interface(
        abi
      ) as ProxyAccount["interface"];

      const encodedBatch = proxyAccountInterface.functions.batch.encode([
        to,
        value,
        data,
        revertOnFail,
        typeOfCall,
        replayProtection,
        AddressZero,
        signature,
      ]);

      const tx = admin.sendTransaction({
        to: forwarder.address,
        data: encodedBatch,
      });

      await expect(tx).to.be.revertedWith(
        "Target, value, calldata, revertOnFail & callType must have the same length"
      );
    }
  ).timeout(500000);

  fnIt<accountFunctions>(
    (a) => a.batch,
    "value has an extra to entry. It should fail.",
    async () => {
      const { msgSenderCon, proxyDeployer, admin, echoCon } = await loadFixture(
        createProxyAccountDeployer
      );

      const proxyAccountAddress = ProxyAccountForwarder.buildProxyAccountAddress(
        admin.address
      );
      const forwarder = new ProxyAccountForwarder(
        ChainID.MAINNET,
        proxyDeployer.address,
        admin,
        proxyAccountAddress,
        new BitFlipReplayProtection(admin, proxyAccountAddress)
      );

      // Deploy proxy contract
      let deployProxy = await forwarder.createProxyContract();

      await admin.sendTransaction({
        to: deployProxy.to,
        data: deployProxy.data,
      });

      const echoData = echoCon.interface.functions.sendMessage.encode([
        "hello",
      ]);
      const callData = msgSenderCon.interface.functions.test.encode([]);

      const to = [msgSenderCon.address, echoCon.address];
      const value = [0, 0, 0];
      const data = [callData, echoData];
      const revertOnFail = [true, true];
      const typeOfCall = [CallType.CALL, CallType.CALL];

      const replayProtection = defaultAbiCoder.encode(["uint", "uint"], [0, 0]);
      const encodedCallData = defaultAbiCoder.encode(
        ["uint", "address[]", "uint[]", "bytes[]", "bool[]", "uint[]"],
        [CallType.BATCH, to, value, data, revertOnFail, typeOfCall]
      );

      // @ts-ignore
      const encodedMetaTx = forwarder.encodeMetaTransactionToSign(
        encodedCallData,
        replayProtection,
        AddressZero
      );

      const signature = await admin.signMessage(
        arrayify(keccak256(encodedMetaTx))
      );

      const proxyAccountInterface = new Interface(
        abi
      ) as ProxyAccount["interface"];

      const encodedBatch = proxyAccountInterface.functions.batch.encode([
        to,
        value,
        data,
        revertOnFail,
        typeOfCall,
        replayProtection,
        AddressZero,
        signature,
      ]);

      const tx = admin.sendTransaction({
        to: forwarder.address,
        data: encodedBatch,
      });

      await expect(tx).to.be.revertedWith(
        "Target, value, calldata, revertOnFail & callType must have the same length"
      );
    }
  ).timeout(500000);

  fnIt<accountFunctions>(
    (a) => a.batch,
    "data has an extra to entry. It should fail.",
    async () => {
      const { msgSenderCon, proxyDeployer, admin, echoCon } = await loadFixture(
        createProxyAccountDeployer
      );

      const proxyAccountAddress = ProxyAccountForwarder.buildProxyAccountAddress(
        admin.address
      );
      const forwarder = new ProxyAccountForwarder(
        ChainID.MAINNET,
        proxyDeployer.address,
        admin,
        proxyAccountAddress,
        new BitFlipReplayProtection(admin, proxyAccountAddress)
      );

      // Deploy proxy contract
      let deployProxy = await forwarder.createProxyContract();

      await admin.sendTransaction({
        to: deployProxy.to,
        data: deployProxy.data,
      });

      const echoData = echoCon.interface.functions.sendMessage.encode([
        "hello",
      ]);
      const callData = msgSenderCon.interface.functions.test.encode([]);

      const to = [msgSenderCon.address, echoCon.address];
      const value = [0, 0];
      const data = [callData, echoData, echoData];
      const revertOnFail = [true, true];
      const typeOfCall = [CallType.CALL, CallType.CALL];

      const replayProtection = defaultAbiCoder.encode(["uint", "uint"], [0, 0]);
      const encodedCallData = defaultAbiCoder.encode(
        ["uint", "address[]", "uint[]", "bytes[]", "bool[]", "uint[]"],
        [CallType.BATCH, to, value, data, revertOnFail, typeOfCall]
      );

      // @ts-ignore
      const encodedMetaTx = forwarder.encodeMetaTransactionToSign(
        encodedCallData,
        replayProtection,
        AddressZero
      );

      const signature = await admin.signMessage(
        arrayify(keccak256(encodedMetaTx))
      );

      const proxyAccountInterface = new Interface(
        abi
      ) as ProxyAccount["interface"];

      const encodedBatch = proxyAccountInterface.functions.batch.encode([
        to,
        value,
        data,
        revertOnFail,
        typeOfCall,
        replayProtection,
        AddressZero,
        signature,
      ]);

      const tx = admin.sendTransaction({
        to: forwarder.address,
        data: encodedBatch,
      });

      await expect(tx).to.be.revertedWith(
        "Target, value, calldata, revertOnFail & callType must have the same length"
      );
    }
  ).timeout(500000);

  fnIt<accountFunctions>(
    (a) => a.batch,
    "revertOnFail has an extra to entry. It should fail.",
    async () => {
      const { msgSenderCon, proxyDeployer, admin, echoCon } = await loadFixture(
        createProxyAccountDeployer
      );

      const proxyAccountAddress = ProxyAccountForwarder.buildProxyAccountAddress(
        admin.address
      );
      const forwarder = new ProxyAccountForwarder(
        ChainID.MAINNET,
        proxyDeployer.address,
        admin,
        proxyAccountAddress,
        new BitFlipReplayProtection(admin, proxyAccountAddress)
      );

      // Deploy proxy contract
      let deployProxy = await forwarder.createProxyContract();

      await admin.sendTransaction({
        to: deployProxy.to,
        data: deployProxy.data,
      });

      const echoData = echoCon.interface.functions.sendMessage.encode([
        "hello",
      ]);
      const callData = msgSenderCon.interface.functions.test.encode([]);

      const to = [msgSenderCon.address, echoCon.address];
      const value = [0, 0];
      const data = [callData, echoData];
      const revertOnFail = [true, true, false];
      const typeOfCall = [CallType.CALL, CallType.CALL];

      const replayProtection = defaultAbiCoder.encode(["uint", "uint"], [0, 0]);
      const encodedCallData = defaultAbiCoder.encode(
        ["uint", "address[]", "uint[]", "bytes[]", "bool[]", "uint[]"],
        [CallType.BATCH, to, value, data, revertOnFail, typeOfCall]
      );

      // @ts-ignore
      const encodedMetaTx = forwarder.encodeMetaTransactionToSign(
        encodedCallData,
        replayProtection,
        AddressZero
      );

      const signature = await admin.signMessage(
        arrayify(keccak256(encodedMetaTx))
      );

      const proxyAccountInterface = new Interface(
        abi
      ) as ProxyAccount["interface"];

      const encodedBatch = proxyAccountInterface.functions.batch.encode([
        to,
        value,
        data,
        revertOnFail,
        typeOfCall,
        replayProtection,
        AddressZero,
        signature,
      ]);

      const tx = admin.sendTransaction({
        to: forwarder.address,
        data: encodedBatch,
      });

      await expect(tx).to.be.revertedWith(
        "Target, value, calldata, revertOnFail & callType must have the same length"
      );
    }
  ).timeout(500000);

  fnIt<accountFunctions>(
    (a) => a.batch,
    "typeOfCall has an extra to entry. It should fail.",
    async () => {
      const { msgSenderCon, proxyDeployer, admin, echoCon } = await loadFixture(
        createProxyAccountDeployer
      );

      const proxyAccountAddress = ProxyAccountForwarder.buildProxyAccountAddress(
        admin.address
      );
      const forwarder = new ProxyAccountForwarder(
        ChainID.MAINNET,
        proxyDeployer.address,
        admin,
        proxyAccountAddress,
        new BitFlipReplayProtection(admin, proxyAccountAddress)
      );

      // Deploy proxy contract
      let deployProxy = await forwarder.createProxyContract();

      await admin.sendTransaction({
        to: deployProxy.to,
        data: deployProxy.data,
      });

      const echoData = echoCon.interface.functions.sendMessage.encode([
        "hello",
      ]);
      const callData = msgSenderCon.interface.functions.test.encode([]);

      const to = [msgSenderCon.address, echoCon.address];
      const value = [0, 0];
      const data = [callData, echoData];
      const revertOnFail = [true, true];
      const typeOfCall = [CallType.CALL, CallType.CALL, CallType.BATCH];

      const replayProtection = defaultAbiCoder.encode(["uint", "uint"], [0, 0]);
      const encodedCallData = defaultAbiCoder.encode(
        ["uint", "address[]", "uint[]", "bytes[]", "bool[]", "uint[]"],
        [CallType.BATCH, to, value, data, revertOnFail, typeOfCall]
      );

      // @ts-ignore
      const encodedMetaTx = forwarder.encodeMetaTransactionToSign(
        encodedCallData,
        replayProtection,
        AddressZero
      );

      const signature = await admin.signMessage(
        arrayify(keccak256(encodedMetaTx))
      );

      const proxyAccountInterface = new Interface(
        abi
      ) as ProxyAccount["interface"];

      const encodedBatch = proxyAccountInterface.functions.batch.encode([
        to,
        value,
        data,
        revertOnFail,
        typeOfCall,
        replayProtection,
        AddressZero,
        signature,
      ]);

      const tx = admin.sendTransaction({
        to: forwarder.address,
        data: encodedBatch,
      });

      await expect(tx).to.be.revertedWith(
        "Target, value, calldata, revertOnFail & callType must have the same length"
      );
    }
  ).timeout(500000);
  // TODO: DEPLOYER DOES NOT REVERT IF IT FAILS.
  // We need a deployer that will!
  // fnIt<accountFunctions>(
  //   (a) => a.forward,
  //   "deploy missing real init code and fails",
  //   async () => {
  //     const { proxyDeployer, owner, sender } = await loadFixture(
  //       createProxyAccountDeployer
  //     );

  //     const msgSenderFactory = new MsgSenderExampleFactory(owner);

  //     await proxyDeployer.connect(sender).createProxyAccount(owner.address);
  //     const baseAccount = await proxyDeployer.baseAccount();
  //     const saltHex = solidityKeccak256(["address"], [owner.address]);
  //     const byteCodeHash = solidityKeccak256(
  //       ["bytes", "bytes20", "bytes"],
  //       [
  //         "0x3d602d80600a3d3981f3363d3d373d3d3d363d73",
  //         baseAccount,
  //         "0x5af43d82803e903d91602b57fd5bf3",
  //       ]
  //     );
  //     const options: Create2Options = {
  //       from: proxyDeployer.address,
  //       salt: saltHex,
  //       initCodeHash: byteCodeHash,
  //     };
  //     const proxyAddress = getCreate2Address(options);

  //     const proxyAccountFactory = new ProxyAccountFactory(sender);
  //     const proxyAccount = proxyAccountFactory.attach(proxyAddress);
  //     const forwarder = await createForwarder(
  //       proxyDeployer,
  //       owner,
  //       ReplayProtectionType.MULTINONCE
  //     );

  //     // Doesn't like bytecode. Meh.
  //     const initCode = msgSenderFactory.bytecode;

  //     // Deploy the proxy using CREATE2
  //     const params = await forwarder.signMetaDeployment(initCode, "0x123");
  //     const deployed = proxyAccount
  //       .connect(sender)
  //       .forward(
  //         params.target,
  //         params.value,
  //         params.data,
  //         params.replayProtection,
  //         params.replayProtectionAuthority,
  //         params.signature
  //       );

  //     await expect(deployed)
  //       .to.emit(proxyAccount, proxyAccount.interface.events.Revert.name)
  //       .withArgs("Create2: Failed on deploy");
  //   }
  // );
});
