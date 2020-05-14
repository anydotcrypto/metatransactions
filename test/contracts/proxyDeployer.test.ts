import "mocha";
import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
import { loadFixture } from "ethereum-waffle";

import {
  keccak256,
  arrayify,
  defaultAbiCoder,
  BigNumber,
  parseEther,
  solidityKeccak256,
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
  ChainID,
  ReplayProtectionType,
  ProxyAccountForwarder,
  MultiNonceReplayProtection,
  BitFlipReplayProtection,
} from "../../src";
import { Provider } from "ethers/providers";
import { Wallet } from "ethers/wallet";
import { ForwardParams } from "../../src/ts/forwarders/forwarder";
import { Create2Options, getCreate2Address } from "ethers/utils/address";
import { ethers } from "ethers";

const expect = chai.expect;
chai.use(chaiAsPromised);
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
  const proxyDeployerFactory = new ProxyAccountDeployerFactory(admin);
  const proxyDeployerCreationTx = proxyDeployerFactory.getDeployTransaction();

  const nonceStoreMock = new Doppelganger(IReplayProtectionJson.interface);
  await nonceStoreMock.deploy(admin);
  await nonceStoreMock.update.returns(true);
  await nonceStoreMock.updateFor.returns(true);

  const bitFlipNonceStoreFactory = new BitFlipNonceStoreFactory(admin);
  const bitFlipNonceStore = await bitFlipNonceStoreFactory.deploy();

  const proxyDeployerCreation = await admin.sendTransaction(
    proxyDeployerCreationTx
  );
  const result = await proxyDeployerCreation.wait(1);

  const msgSenderFactory = new MsgSenderExampleFactory(admin);
  const msgSenderCon = await msgSenderFactory.deploy(result.contractAddress!);
  const proxyDeployer = proxyDeployerFactory.attach(result.contractAddress!);
  return {
    provider,
    proxyDeployer,
    admin,
    owner,
    sender,
    msgSenderCon,
    nonceStoreMock,
    bitFlipNonceStore,
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
        proxyDeployer.address,
        sender.address,
        baseAccount
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
    const baseAccount = await proxyDeployer.baseAccount();
    const proxyAccountAddress = ProxyAccountForwarder.buildProxyAccountAddress(
      proxyDeployer.address,
      user.address,
      baseAccount
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
    "returns encoded forward calldata that we send in a transaction",
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
        data: await forwarder.encodeSignedMetaTransaction(params),
      });

      await expect(tx)
        .to.emit(msgSenderCon, msgSenderCon.interface.events.WhoIsSender.name)
        .withArgs(proxyAddress);
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
    (a) => a.deployContract,
    "deploys a contract via the proxy account",
    async () => {
      const { proxyDeployer, owner, sender } = await loadFixture(
        createProxyAccountDeployer
      );

      const msgSenderFactory = new MsgSenderExampleFactory(owner);

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
      const proxyOptions: Create2Options = {
        from: proxyDeployer.address,
        salt: saltHex,
        initCodeHash: byteCodeHash,
      };
      const proxyAddress = getCreate2Address(proxyOptions);
      const proxyAccountFactory = new ProxyAccountFactory(sender);
      const proxyAccount = proxyAccountFactory.attach(proxyAddress);

      const forwarder = await createForwarder(
        proxyDeployer,
        owner,
        ReplayProtectionType.MULTINONCE
      );

      const initCode = msgSenderFactory.getDeployTransaction(
        proxyDeployer.address
      ).data! as string;

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

      const options: Create2Options = {
        from: params.to,
        salt: salt,
        initCodeHash: hByteCode,
      };
      // Fetch the proxy on-chain instance
      const msgSenderExampleAddress = getCreate2Address(options);
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
      const params = await forwarder.signMetaDeployment(initCode);
      const encodedMetaDeployment = await forwarder.encodeSignedMetaDeployment(
        params
      );
      await sender.sendTransaction({
        to: params.to,
        data: encodedMetaDeployment,
      });

      // Compute deterministic address
      const hByteCode = arrayify(keccak256(initCode));
      const encodeToSalt = defaultAbiCoder.encode(
        ["address", "bytes"],
        [owner.address, params.replayProtection]
      );
      const salt = arrayify(keccak256(encodeToSalt));

      const options: Create2Options = {
        from: params.to,
        salt: salt,
        initCodeHash: hByteCode,
      };
      // Fetch the proxy on-chain instance
      const msgSenderExampleAddress = getCreate2Address(options);
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
      const { proxyDeployer, owner, sender } = await loadFixture(
        createProxyAccountDeployer
      );

      const msgSenderFactory = new MsgSenderExampleFactory(owner);

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

      const proxyAccountFactory = new ProxyAccountFactory(sender);
      const proxyAccount = proxyAccountFactory.attach(proxyAddress);
      const forwarder = await createForwarder(
        proxyDeployer,
        owner,
        ReplayProtectionType.MULTINONCE
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
