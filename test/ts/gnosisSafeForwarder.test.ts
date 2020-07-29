import "mocha";
import * as chai from "chai";
import { solidity, loadFixture } from "ethereum-waffle";
import {
  deployMetaTxContracts,
  ProxyFactoryFactory,
  GnosisSafeFactory,
  GnosisSafeForwarder,
  EchoFactory,
  CounterFactory,
  MultiSender,
  MultiSendTx,
  CallType,
  GnosisSafe,
  ProxyFactory,
  MULTI_SEND_ADDRESS,
} from "../../src";

import { Provider } from "ethers/providers";
import { Wallet } from "ethers/wallet";
import { ChainID } from "../../src/ts/forwarders/forwarderFactory";
import { parseEther, BigNumber } from "ethers/utils";
import { Echo } from "../../src/typedContracts/Echo";
import { AddressZero } from "ethers/constants";

const expect = chai.expect;
chai.use(solidity);

async function setupProxy(
  owner: Wallet,
  options?: { proxyFactory: ProxyFactory; gnosisSafeMaster: GnosisSafe }
) {
  const gnosisForwarder = new GnosisSafeForwarder(
    ChainID.MAINNET,
    owner,
    owner.address,
    {
      gnosisSafeMaster: options?.gnosisSafeMaster.address,
      proxyFactoryAddress: options?.proxyFactory.address,
    }
  );

  const tx = await gnosisForwarder.createProxyContract();

  await owner.sendTransaction({ to: tx.to, data: tx.data });

  expect(await gnosisForwarder.isContractDeployed(), "deployed").to.be.true;

  return { gnosisForwarder };
}
async function createSafe(
  provider: Provider,
  [admin, owner, sender]: Wallet[]
) {
  const {
    proxyFactoryAddress,
    gnosisSafeAddress,
  } = await deployMetaTxContracts(admin, false);

  const proxyFactory = new ProxyFactoryFactory(admin).attach(
    proxyFactoryAddress
  );

  const gnosisSafeMaster = new GnosisSafeFactory(admin).attach(
    gnosisSafeAddress
  );

  return {
    provider,
    admin,
    owner,
    sender,
    proxyFactory,
    gnosisSafeMaster,
  };
}

describe("GnosisSafe Forwarder", () => {
  it("Deploy proxy account and verify the correct address is computed.", async () => {
    const { provider, owner } = await loadFixture(createSafe);

    const { gnosisForwarder } = await setupProxy(owner);
    const code = await provider.getCode(gnosisForwarder.address);
    expect(code).to.not.eq("0x");
  }).timeout(50000);

  it("Send a single transaction to an echo contract", async () => {
    const { owner } = await loadFixture(createSafe);
    const { gnosisForwarder } = await setupProxy(owner);

    const echoCon = await new EchoFactory(owner).deploy();
    // Let's send a transaction via Gnosis Safe
    const data = echoCon.interface.functions.sendMessage.encode(["hello"]);

    const minimalTx = await gnosisForwarder.signMetaTransaction({
      to: echoCon.address,
      data: data,
      value: 0,
    });

    const echoTx = await owner.sendTransaction({
      to: minimalTx.to,
      data: minimalTx.data,
    });
    await echoTx.wait();
    const lastMessage = await echoCon.lastMessage();

    expect(
      lastMessage,
      "Last message should be recorded in the echo contract as hello."
    ).to.eq("hello");
  }).timeout(50000);

  it("Meta-deploy the echo contract", async () => {
    const { owner } = await loadFixture(createSafe);
    const { gnosisForwarder } = await setupProxy(owner);

    const initCode = new EchoFactory(owner).getDeployTransaction()
      .data! as string;

    const minimalTx = await gnosisForwarder.signMetaTransaction({
      data: initCode,
      salt: "0x123",
      value: 0,
    });

    const deployTx = await owner.sendTransaction({
      to: minimalTx.to,
      data: minimalTx.data,
    });
    await deployTx.wait(1);

    const echoAddress = gnosisForwarder.buildDeployedContractAddress(
      initCode,
      "0x123"
    );

    const echoInterface = new EchoFactory().interface as Echo["interface"];
    const data = echoInterface.functions.sendMessage.encode([
      "meta-deployed yay",
    ]);

    const echoMinimaltx = await gnosisForwarder.signMetaTransaction({
      to: echoAddress,
      data: data,
    });
    const echoTx = await owner.sendTransaction({
      to: echoMinimaltx.to,
      data: echoMinimaltx.data,
    });
    await echoTx.wait(1);

    const echoCon = new EchoFactory(owner).attach(echoAddress);
    const lastMessage = await echoCon.lastMessage();

    expect(
      lastMessage,
      "Last message should be recorded in the echo contract."
    ).to.eq("meta-deployed yay");
  }).timeout(50000);

  it("Transfer 1 eth via the wallet contract to a random wallet address", async () => {
    const { provider, owner } = await loadFixture(createSafe);

    const { gnosisForwarder } = await setupProxy(owner);

    const transferAmount = parseEther("1");
    await owner.sendTransaction({
      to: gnosisForwarder.address,
      value: transferAmount,
    });

    const noBalanceWallet = Wallet.createRandom();

    const minimalTx = await gnosisForwarder.signMetaTransaction({
      to: noBalanceWallet.address,
      data: "0x",
      value: transferAmount,
    });

    const valuetx = await owner.sendTransaction({
      to: minimalTx.to,
      data: minimalTx.data,
    });

    await valuetx.wait();

    const bal = await provider.getBalance(noBalanceWallet.address);
    expect(bal.eq(transferAmount)).to.be.true;
  }).timeout(50000);

  it("Send 10 transactions in a row to an echo contract", async () => {
    const { owner } = await loadFixture(createSafe);
    const { gnosisForwarder } = await setupProxy(owner);

    const echoCon = await new EchoFactory(owner).deploy();

    for (let i = 0; i < 10; i++) {
      const msg = "hello" + i;
      // Let's send a transaction via Gnosis Safe
      const data = echoCon.interface.functions.sendMessage.encode([msg]);

      const minimalTx = await gnosisForwarder.signMetaTransaction({
        to: echoCon.address,
        data: data,
        value: 0,
      });

      const echoTx = await owner.sendTransaction({
        to: minimalTx.to,
        data: minimalTx.data,
      });
      await echoTx.wait(1);
      const lastMessage = await echoCon.lastMessage();

      expect(
        lastMessage,
        "Last message should be recorded in the echo contract as hello."
      ).to.eq(msg);
    }
  }).timeout(50000);

  it("Send a single batch transaction that increments the counter contract 5 times.", async () => {
    const { owner } = await loadFixture(createSafe);

    const { gnosisForwarder } = await setupProxy(owner);
    const counterCon = await new CounterFactory(owner).deploy();

    // Let's send a transaction via Gnosis Safe
    const data = counterCon.interface.functions.increment.encode([]);

    const minimalTx = await gnosisForwarder.signMetaTransaction([
      {
        to: counterCon.address,
        data: data,
      },
      {
        to: counterCon.address,
        data: data,
      },
      {
        to: counterCon.address,
        data: data,
      },
      {
        to: counterCon.address,
        data: data,
      },
      {
        to: counterCon.address,
        data: data,
      },
    ]);

    const counterTx = await owner.sendTransaction({
      to: minimalTx.to,
      data: minimalTx.data,
    });
    await counterTx.wait();
    const incrementedCounter = await counterCon.c();

    expect(
      incrementedCounter.toNumber(),
      "Counter should be incremented to 5 due to batch transaction"
    ).to.eq(5);
  }).timeout(50000);

  it("Send a 10 batch transaction that increments the counter contract 5 times.", async () => {
    const { owner } = await loadFixture(createSafe);

    const counterCon = await new CounterFactory(owner).deploy();
    const { gnosisForwarder } = await setupProxy(owner);

    // Let's send a transaction via Gnosis Safe
    const data = counterCon.interface.functions.increment.encode([]);

    for (let i = 1; i <= 10; i++) {
      const minimalTx = await gnosisForwarder.signMetaTransaction([
        {
          to: counterCon.address,
          data: data,
        },
        {
          to: counterCon.address,
          data: data,
        },
        {
          to: counterCon.address,
          data: data,
        },
        {
          to: counterCon.address,
          data: data,
        },
        {
          to: counterCon.address,
          data: data,
        },
      ]);

      const counterTx = await owner.sendTransaction({
        to: minimalTx.to,
        data: minimalTx.data,
      });
      await counterTx.wait();
      const incrementedCounter = await counterCon.c();

      expect(
        incrementedCounter.toNumber(),
        "Counter should be incremented to 5 due to batch transaction"
      ).to.eq(5 * i);
    }
  }).timeout(50000);

  it("Decode a meta-transaction", async () => {
    const { sender, owner, proxyFactory, gnosisSafeMaster } = await loadFixture(
      createSafe
    );
    const echoCon = await new EchoFactory(sender).deploy();
    const { gnosisForwarder } = await setupProxy(owner, {
      proxyFactory,
      gnosisSafeMaster,
    });

    // Let's send a transaction via Gnosis Safe
    const data = echoCon.interface.functions.sendMessage.encode(["hello"]);

    const minimalTx = await gnosisForwarder.signMetaTransaction({
      to: echoCon.address,
      data: data,
      value: 0,
    });

    const decodedTx = gnosisForwarder.decodeTx(minimalTx.data);

    expect(decodedTx.to, "Sending to the echo contract").to.eq(echoCon.address);
    expect(decodedTx.data, "Data for the echo contract").to.eq(data);
    expect(decodedTx.value.toString(), "Zero value sent").to.eq("0");
    expect(decodedTx.operation.toString(), "CALL type").to.eq("0");

    expect(decodedTx.baseGas.toString(), "base gas").to.eq("0");
    expect(decodedTx.gasPrice.toString(), "gas price").to.eq("0");
    expect(decodedTx.gasToken, "gas token").to.eq(AddressZero);
    expect(decodedTx.refundReceiver, "refund receiver").to.eq(AddressZero);
    expect(decodedTx.safeTxGas.toString(), "safe tx gas").to.eq("0");

    expect(await echoCon.functions.lastMessage(), "start last message").to.eq(
      ""
    );

    const gnosisSafe = new GnosisSafeFactory(sender).attach(
      gnosisForwarder.address
    );
    await (
      await gnosisSafe.functions.execTransaction(
        decodedTx.to,
        decodedTx.value,
        decodedTx.data,
        decodedTx.operation,
        decodedTx.safeTxGas,
        decodedTx.baseGas,
        decodedTx.gasPrice,
        decodedTx.gasToken,
        decodedTx.refundReceiver,
        decodedTx.signatures
      )
    ).wait();
    expect(await echoCon.functions.lastMessage(), "end last message").to.eq(
      "hello"
    );
  }).timeout(50000);

  it("Decode a meta-transaction batch", async () => {
    const { owner } = await loadFixture(createSafe);

    const echoCon = await new EchoFactory(owner).deploy();

    const gnosisForwarder = new GnosisSafeForwarder(
      ChainID.MAINNET,
      owner,
      owner.address
    );

    // Let's send a transaction via Gnosis Safe
    const data = echoCon.interface.functions.sendMessage.encode(["hello"]);

    const toBatch: MultiSendTx[] = [
      {
        to: echoCon.address,
        data: data,
        value: new BigNumber(0),
        callType: CallType.CALL,
        revertOnFail: true,
      },
      {
        to: echoCon.address,
        data: data,
        value: new BigNumber(1),
        callType: CallType.DELEGATE,
        revertOnFail: false,
      },
    ];

    const minimalTx = await gnosisForwarder.signMetaTransaction(toBatch);

    const decodedTx = gnosisForwarder.decodeTx(minimalTx.data);

    expect(decodedTx.to, "Sending to the echo contract").to.eq(
      MULTI_SEND_ADDRESS
    );
    expect(decodedTx.value.toString(), "Zero value sent").to.eq("0");
    // batches are delegate calls
    expect(decodedTx.operation.toString(), "CALL type").to.eq("1");

    expect(decodedTx.baseGas.toString(), "base gas").to.eq("0");
    expect(decodedTx.gasPrice.toString(), "gas price").to.eq("0");
    expect(decodedTx.gasToken, "gas token").to.eq(AddressZero);
    expect(decodedTx.refundReceiver, "refund receiver").to.eq(AddressZero);
    expect(decodedTx.safeTxGas.toString(), "safe tx gas").to.eq("0");

    const multiSender = new MultiSender();
    const decodedDataBatch = multiSender.decodeBatch(decodedTx.data);
    expect(decodedDataBatch, "Decoded data did not match").to.deep.eq(toBatch);
  }).timeout(50000);
});
