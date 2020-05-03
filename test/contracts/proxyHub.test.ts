import "mocha";
import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
import { loadFixture } from "ethereum-waffle";
import { when, spy } from "ts-mockito";

import {
  keccak256,
  arrayify,
  defaultAbiCoder,
  BigNumber,
  parseEther,
} from "ethers/utils";

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
} from "../../src";
import { Provider } from "ethers/providers";
import { Wallet } from "ethers/wallet";
import {
  ForwarderFactory,
  ChainID,
  ReplayProtectionType,
  ForwarderType,
} from "../../src/ts/forwarderfactory";
import { ProxyAccountForwarder } from "../../src/ts/proxyaccountfowarder";
import { ForwardParams } from "../../src/ts/forwarder";

const expect = chai.expect;
chai.use(chaiAsPromised);
let hubClass: ProxyAccountDeployer;
let accountClass: ProxyAccount;

type proxyHubFunctions = typeof hubClass.functions;
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
  const proxyHubFactory = new ProxyAccountDeployerFactory(admin);
  const proxyHubCreationTx = proxyHubFactory.getDeployTransaction();

  const nonceStoreMock = new Doppelganger(IReplayProtectionJson.interface);
  await nonceStoreMock.deploy(admin);
  await nonceStoreMock.update.returns(true);
  await nonceStoreMock.updateFor.returns(true);

  const bitFlipNonceStoreFactory = new BitFlipNonceStoreFactory(admin);
  const bitFlipNonceStore = await bitFlipNonceStoreFactory.deploy();

  const proxyHubCreation = await admin.sendTransaction(proxyHubCreationTx);
  const result = await proxyHubCreation.wait(1);

  const msgSenderFactory = new MsgSenderExampleFactory(admin);
  const msgSenderCon = await msgSenderFactory.deploy(result.contractAddress!);
  const proxyHub = proxyHubFactory.attach(result.contractAddress!);

  const spiedForwarderFactory = spy(ForwarderFactory);
  when(
    // @ts-ignore
    spiedForwarderFactory.getForwarderAddress(
      ChainID.MAINNET,
      ForwarderType.PROXYACCOUNTDEPLOYER
    )
  ).thenReturn(proxyHub.address);

  return {
    provider,
    proxyHub,
    admin,
    owner,
    sender,
    msgSenderCon,
    nonceStoreMock,
    bitFlipNonceStore,
  };
}

describe("ProxyAccountFactoryProxy", () => {
  fnIt<proxyHubFunctions>(
    (a) => a.createProxyAccount,
    "create proxy account with deterministic address (and compute offchain deterministic address)",
    async () => {
      const { proxyHub, sender } = await loadFixture(
        createProxyAccountDeployer
      );

      await proxyHub.connect(sender).createProxyAccount(sender.address);
      const proxyAddress = await proxyHub
        .connect(sender)
        .accounts(sender.address);

      const baseAddress = await proxyHub.baseAccount();
      const builtAddress = ProxyAccountForwarder.buildCreate2Address(
        proxyHub.address,
        sender.address,
        baseAddress
      );

      // Computed offchain
      expect(proxyAddress.toLowerCase()).to.eq(builtAddress);
      // Expected deployed cotnract
      expect(proxyAddress).to.eq("0xAcC70E67808E3AAEFa90077F3d92f80c90A7988E");
    }
  );

  fnIt<proxyHubFunctions>(
    (a) => a.createProxyAccount,
    "cannot re-create the same proxy twice",
    async () => {
      const { proxyHub, sender } = await loadFixture(
        createProxyAccountDeployer
      );

      await proxyHub.connect(sender).createProxyAccount(sender.address);
      const tx = proxyHub.connect(sender).createProxyAccount(sender.address);

      await expect(tx).to.be.reverted;
    }
  );

  fnIt<accountFunctions>(
    (a) => a.forward,
    "for proxyAccount emits expected address",
    async () => {
      const { proxyHub, owner, sender, msgSenderCon } = await loadFixture(
        createProxyAccountDeployer
      );
      const msgSenderCall = msgSenderCon.interface.functions.test.encode([]);

      await proxyHub.connect(sender).createProxyAccount(owner.address);
      const proxyAddress = await proxyHub
        .connect(sender)
        .accounts(owner.address);

      const proxyAccountFactory = new ProxyAccountFactory(owner);
      const proxyAccount = proxyAccountFactory.attach(proxyAddress);
      const forwarder = await ForwarderFactory.getProxyForwarder(
        ChainID.MAINNET,
        ReplayProtectionType.MULTINONCE,
        owner
      );

      const params = await forwarder.signMetaTransaction({
        target: msgSenderCon.address,
        value: new BigNumber("0"),
        callData: msgSenderCall,
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
      const { proxyHub, owner, sender, msgSenderCon } = await loadFixture(
        createProxyAccountDeployer
      );

      const msgSenderCall = msgSenderCon.interface.functions.test.encode([]);
      const forwarder = await ForwarderFactory.getProxyForwarder(
        ChainID.MAINNET,
        ReplayProtectionType.MULTINONCE,
        owner
      );

      await proxyHub.connect(sender).createProxyAccount(owner.address);
      const params = await forwarder.signMetaTransaction({
        target: msgSenderCon.address,
        value: new BigNumber("0"),
        callData: msgSenderCall,
      });

      const tx = sender.sendTransaction({
        to: params.to,
        data: await forwarder.encodeSignedMetaTransaction(params),
      });

      await expect(tx).to.emit(
        msgSenderCon,
        msgSenderCon.interface.events.WhoIsSender.name
      );
    }
  );

  fnIt<accountFunctions>(
    (a) => a.forward,
    "returns encoded forward calldata that we send in a transaction",
    async () => {
      const { proxyHub, owner, sender, msgSenderCon } = await loadFixture(
        createProxyAccountDeployer
      );
      const msgSenderCall = msgSenderCon.interface.functions.test.encode([]);
      const forwarder = await ForwarderFactory.getProxyForwarder(
        ChainID.MAINNET,
        ReplayProtectionType.MULTINONCE,
        owner
      );

      await proxyHub.connect(sender).createProxyAccount(owner.address);
      const proxyAddress = await proxyHub.accounts(owner.address);
      const params = await forwarder.signMetaTransaction({
        target: msgSenderCon.address,
        value: new BigNumber("0"),
        callData: msgSenderCall,
      });

      const tx = sender.sendTransaction({
        to: proxyAddress,
        gasLimit: 500000,
        gasPrice: parseEther("0.000001"),
        data: await forwarder.encodeSignedMetaTransaction(params),
      });

      await expect(tx)
        .to.emit(msgSenderCon, msgSenderCon.interface.events.WhoIsSender.name)
        .withArgs(proxyAddress);
    }
  );

  fnIt<accountFunctions>(
    (a) => a.deployContract,
    "deploys a contract via the proxyHub",
    async () => {
      const { proxyHub, owner, sender } = await loadFixture(
        createProxyAccountDeployer
      );

      const msgSenderFactory = new MsgSenderExampleFactory(owner);

      await proxyHub.connect(sender).createProxyAccount(owner.address);
      const proxyAccountAddr = await proxyHub
        .connect(sender)
        .accounts(owner.address);
      const proxyAccountFactory = new ProxyAccountFactory(sender);
      const proxyAccount = proxyAccountFactory.attach(proxyAccountAddr);

      const forwarder = await ForwarderFactory.getProxyForwarder(
        ChainID.MAINNET,
        ReplayProtectionType.MULTINONCE,
        owner
      );

      const initCode = msgSenderFactory.getDeployTransaction(proxyHub.address)
        .data! as string;

      // Deploy the proxy using CREATE2
      const params = await forwarder.signMetaDeployment(initCode);
      await proxyAccount
        .connect(sender)
        .deployContract(
          params.initCode,
          params.replayProtection,
          params.replayProtectionAuthority,
          params.signature
        );

      // Compute deterministic address
      const hByteCode = arrayify(keccak256(initCode));
      const encodeToSalt = defaultAbiCoder.encode(
        ["address", "bytes"],
        [owner.address, params.replayProtection]
      );
      const salt = arrayify(keccak256(encodeToSalt));

      // Fetch the proxy on-chain instance
      const msgSenderExampleAddress = await proxyAccount
        .connect(sender)
        .computeAddress(salt, hByteCode);
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
    (a) => a.deployContract,
    "deploy missing real init code and fails",
    async () => {
      const { proxyHub, owner, sender } = await loadFixture(
        createProxyAccountDeployer
      );

      const msgSenderFactory = new MsgSenderExampleFactory(owner);

      await proxyHub.connect(sender).createProxyAccount(owner.address);
      const proxyAccountAddr = await proxyHub
        .connect(sender)
        .accounts(owner.address);

      const proxyAccountFactory = new ProxyAccountFactory(sender);
      const proxyAccount = proxyAccountFactory.attach(proxyAccountAddr);

      const forwarder = await ForwarderFactory.getProxyForwarder(
        ChainID.MAINNET,
        ReplayProtectionType.MULTINONCE,
        owner
      );

      // Doesn't like bytecode. Meh.
      const initCode = msgSenderFactory.bytecode;

      // Deploy the proxy using CREATE2
      const params = await forwarder.signMetaDeployment(initCode);
      const deployed = proxyAccount
        .connect(sender)
        .deployContract(
          params.initCode,
          params.replayProtection,
          params.replayProtectionAuthority,
          params.signature
        );

      await expect(deployed).to.revertedWith("Create2: Failed on deploy");
    }
  );
});
