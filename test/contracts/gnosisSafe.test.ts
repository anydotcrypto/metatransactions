import "mocha";
import * as chai from "chai";
import { solidity, loadFixture } from "ethereum-waffle";
import { fnIt } from "@pisa-research/test-utils";
import { Wallet } from "ethers";
import { Provider } from "ethers/providers";
import {
  GnosisSafeFactory,
  ProxyFactoryFactory,
  GnosisSafe,
  ProxyFactory,
  GnosisProxyFactory,
  EchoFactory,
  CounterFactory,
  MultiSender,
  deployMetaTxContracts,
  MULTI_SEND_ADDRESS,
} from "../../src";
import { AddressZero } from "ethers/constants";
import {
  getCreate2Address,
  solidityKeccak256,
  keccak256,
  defaultAbiCoder,
  arrayify,
  joinSignature,
  splitSignature,
  SigningKey,
  hexlify,
  concat,
} from "ethers/utils";
import { Create2Options } from "ethers/utils/address";

const expect = chai.expect;
chai.use(solidity);

type gnosisSafeFunctions = GnosisSafe["functions"];
type proxyFactoryFunctions = ProxyFactory["functions"];

async function createSafe(
  provider: Provider,
  [admin, owner, sender]: Wallet[]
) {
  await deployMetaTxContracts(admin);

  const proxyFactory = await new ProxyFactoryFactory(admin).deploy();
  const gnosisSafeMaster = await new GnosisSafeFactory(admin).deploy();
  return {
    provider,
    admin,
    owner,
    sender,
    proxyFactory,
    gnosisSafeMaster,
  };
}

async function deployProxy(
  gnosisSafeMaster: GnosisSafe,
  proxyFactory: ProxyFactory,
  owner: Wallet
) {
  const setup = gnosisSafeMaster.interface.functions.setup.encode([
    [owner.address],
    1,
    AddressZero,
    "0x",
    AddressZero,
    AddressZero,
    0,
    AddressZero  ]);

  const salt = keccak256("0x123");
  // Signer's address is inside the initializer data and that is used to create the contract address
  const tx = await proxyFactory.createProxyWithNonce(
    gnosisSafeMaster.address,
    setup,
    salt
  );

  await tx.wait(1);

  const deployTx = new GnosisProxyFactory(owner).getDeployTransaction(
    gnosisSafeMaster.address
  );
  const create2Options: Create2Options = {
    from: proxyFactory.address,
    salt: solidityKeccak256(["bytes32", "uint"], [keccak256(setup), salt]),
    initCode: deployTx.data,
  };
  return getCreate2Address(create2Options);
}

async function prepareTransactionData(
  targetContractAddress: string,
  targetContractData: string,
  proxyAddress: string,
  signer: Wallet,
  gnosisSafeMaster: GnosisSafe,
  callType?: number,
  prefix?: boolean
) {
  const TYPEHASH =
    "0xbb8310d486368db6bd6f849402fdd73ad53d316b5a4b2644ad6efe0f941286d8";
  const to = targetContractAddress;
  const value = 0;
  const data = targetContractData;
  const operation = callType ? callType : 0; // 0 = call, 1 = delegatecall
  const safeTxGas = 0;
  const baseGas = 0;
  const gasPrice = 0;
  const gasToken = AddressZero;
  const refundReceiver = AddressZero;
  const nonce = 0;

  const encodedTxData = defaultAbiCoder.encode(
    [
      "bytes32",
      "address",
      "uint",
      "bytes32",
      "uint",
      "uint",
      "uint",
      "uint",
      "address",
      "address",
      "uint",
    ],
    [
      TYPEHASH,
      to,
      value,
      keccak256(data),
      operation,
      safeTxGas,
      baseGas,
      gasPrice,
      gasToken,
      refundReceiver,
      nonce,
    ]
  );

  const txHash = keccak256(encodedTxData);

  const domainSeparator = keccak256(
    defaultAbiCoder.encode(
      ["bytes32", "address"],
      [
        "0x035aff83d86937d35b32e04f0ddc6ff469290eef2f1b692d8a815c89404d4749",
        proxyAddress,
      ]
    )
  );

  // const domainSeparator = await gnosisSafeMaster.domainSeparator();
  const txHashData = solidityKeccak256(
    ["bytes1", "bytes1", "bytes32", "bytes32"],
    ["0x19", "0x01", domainSeparator, txHash]
  );

  let jointSignature: string;
  if (prefix != undefined && prefix) {
    const signature = await signer.signMessage(arrayify(txHashData));
    const splitSig = splitSignature(signature);
    let recParam;
    if (splitSig.v! == 27) {
      recParam = "0x1f";
    } else {
      recParam = "0x20";
    }
    jointSignature = hexlify(concat([splitSig.r, splitSig.s, recParam]));
  } else {
    const key = new SigningKey(signer.privateKey);
    const signature = key.signDigest(arrayify(txHashData));
    jointSignature = joinSignature(signature);
  }

  return gnosisSafeMaster.interface.functions.execTransaction.encode([
    to,
    value,
    data,
    operation,
    safeTxGas,
    baseGas,
    gasPrice,
    gasToken,
    refundReceiver,
    jointSignature,
  ]);
}
describe("GnosisSafe", () => {
  fnIt<gnosisSafeFunctions>(
    (a) => a.execTransaction,
    "deploy proxy contract for the user",
    async () => {
      const {
        provider,
        proxyFactory,
        gnosisSafeMaster,
        owner,
      } = await loadFixture(createSafe);

      const proxyAddress = await deployProxy(
        gnosisSafeMaster,
        proxyFactory,
        owner
      );

      const code = await provider.getCode(proxyAddress);
      expect(code, "Proxy code must be deployed.").not.eq("0x");
    }
  );

  fnIt<proxyFactoryFunctions>(
    (a) => a.createProxyWithNonce,
    "executes a transaction that increments the counter contract 5 times. Verified by signature (no prefix) and performs a CALL.",
    async () => {
      const {
        provider,
        proxyFactory,
        gnosisSafeMaster,
        owner,
      } = await loadFixture(createSafe);

      const proxyAddress = await deployProxy(
        gnosisSafeMaster,
        proxyFactory,
        owner
      );

      const code = await provider.getCode(proxyAddress);
      expect(code, "Proxy code must be deployed.").not.eq("0x");

      const message = "hello";
      const echo = await new EchoFactory(owner).deploy();
      const data = echo.interface.functions.sendMessage.encode([message]);
      const txData = await prepareTransactionData(
        echo.address,
        data,
        proxyAddress,
        owner,
        gnosisSafeMaster
      );

      const sendTx = await owner.sendTransaction({
        to: proxyAddress,
        data: txData,
      });
      await sendTx.wait(1);

      const echoMessage = await echo.lastMessage();
      expect(echoMessage, "Expecting echo message").to.eq(message);
    }
  );

  fnIt<proxyFactoryFunctions>(
    (a) => a.createProxyWithNonce,
    "executes a batch transaction that increments the counter contract 5 times. Verified by signature (no prefix) and performs a CALL.",
    async () => {
      const {
        provider,
        proxyFactory,
        gnosisSafeMaster,
        owner,
      } = await loadFixture(createSafe);

      const proxyAddress = await deployProxy(
        gnosisSafeMaster,
        proxyFactory,
        owner
      );

      const code = await provider.getCode(proxyAddress);
      expect(code, "Proxy code must be deployed.").not.eq("0x");

      const counter = await new CounterFactory(owner).deploy();
      const data = counter.interface.functions.increment.encode([]);

      const batch = new MultiSender().batch([
        { to: counter.address, data: data, revertOnFail: true },
        { to: counter.address, data: data, revertOnFail: true },
        { to: counter.address, data: data, revertOnFail: true },
        { to: counter.address, data: data, revertOnFail: true },
        { to: counter.address, data: data, revertOnFail: true },
      ]);

      const txData = await prepareTransactionData(
        batch.to,
        batch.data,
        proxyAddress,
        owner,
        gnosisSafeMaster,
        0
      );

      const sendTx = await owner.sendTransaction({
        to: proxyAddress,
        data: txData,
      });
      await sendTx.wait(1);
      const c = await counter.c();
      const sentBy = await counter.lastSentBy();

      expect(c.eq(5), "Counter should be incremented 5 times").to.be.true;
      expect(
        sentBy,
        "Counter should be incremented by the multi-send address."
      ).to.eq(MULTI_SEND_ADDRESS);
    }
  );

  fnIt<proxyFactoryFunctions>(
    (a) => a.createProxyWithNonce,
    "executes a batch transaction echo contract. Verified by signature (no prefix) and performs a DELEGATE.",
    async () => {
      const {
        provider,
        proxyFactory,
        gnosisSafeMaster,
        owner,
      } = await loadFixture(createSafe);

      const proxyAddress = await deployProxy(
        gnosisSafeMaster,
        proxyFactory,
        owner
      );

      const code = await provider.getCode(proxyAddress);
      expect(code, "Proxy code must be deployed.").not.eq("0x");

      const counter = await new CounterFactory(owner).deploy();
      const data = counter.interface.functions.increment.encode([]);

      const batch = new MultiSender().batch([
        { to: counter.address, data: data, revertOnFail: true },
        { to: counter.address, data: data, revertOnFail: true },
        { to: counter.address, data: data, revertOnFail: true },
        { to: counter.address, data: data, revertOnFail: true },
        { to: counter.address, data: data, revertOnFail: true },
      ]);

      const txData = await prepareTransactionData(
        batch.to,
        batch.data,
        proxyAddress,
        owner,
        gnosisSafeMaster,
        1
      );

      const sendTx = await owner.sendTransaction({
        to: proxyAddress,
        data: txData,
      });
      await sendTx.wait(1);
      const c = await counter.c();
      const sentBy = await counter.lastSentBy();
      expect(c.eq(5), "Counter should be incremented 5 times").to.be.true;
      expect(
        sentBy,
        "Counter should be incremented by the proxy contract."
      ).to.eq(proxyAddress);
    }
  );

  fnIt<proxyFactoryFunctions>(
    (a) => a.createProxyWithNonce,
    "executes the echo contract, but with the message prefix as part of signature (v > 30)",
    async () => {
      const {
        provider,
        proxyFactory,
        gnosisSafeMaster,
        owner,
      } = await loadFixture(createSafe);

      const proxyAddress = await deployProxy(
        gnosisSafeMaster,
        proxyFactory,
        owner
      );

      const code = await provider.getCode(proxyAddress);
      expect(code, "Proxy code must be deployed.").not.eq("0x");

      const message = "hello";
      const echo = await new EchoFactory(owner).deploy();
      const data = echo.interface.functions.sendMessage.encode([message]);
      const txData = await prepareTransactionData(
        echo.address,
        data,
        proxyAddress,
        owner,
        gnosisSafeMaster,
        0,
        true
      );

      const sendTx = await owner.sendTransaction({
        to: proxyAddress,
        data: txData,
      });
      await sendTx.wait(1);

      const echoMessage = await echo.lastMessage();
      expect(echoMessage, "Expecting echo message").to.eq(message);
    }
  );
});
