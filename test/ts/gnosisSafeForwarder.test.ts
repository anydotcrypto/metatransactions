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
} from "../../src";

import { Provider } from "ethers/providers";
import { Wallet } from "ethers/wallet";
import { ChainID } from "../../src/ts/forwarders/forwarderFactory";
import { PROXY_FACTORY_ADDRESS } from "../../src/deployment/addresses";
import { parseEther, BigNumber } from "ethers/utils";

const expect = chai.expect;
chai.use(solidity);

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
    const { provider, owner, sender } = await loadFixture(createSafe);

    const proxyAccountAddress = GnosisSafeForwarder.buildProxyAccountAddress(
      owner,
      owner.address
    );

    const gnosisForwarder = new GnosisSafeForwarder(
      ChainID.MAINNET,
      PROXY_FACTORY_ADDRESS,
      owner,
      proxyAccountAddress
    );

    const tx = await gnosisForwarder.createProxyContract();

    await sender.sendTransaction({ to: tx.to, data: tx.data });
    const code = await provider.getCode(proxyAccountAddress);

    expect(code).to.not.eq("0x");
    expect(await gnosisForwarder.isContractDeployed()).to.be.true;
  }).timeout(50000);

  it("Send a single transaction to an echo contract", async () => {
    const { provider, owner, gnosisSafeMaster } = await loadFixture(createSafe);

    const echoCon = await new EchoFactory(owner).deploy();

    const proxyAccountAddress = GnosisSafeForwarder.buildProxyAccountAddress(
      owner,
      owner.address
    );

    const gnosisForwarder = new GnosisSafeForwarder(
      ChainID.MAINNET,
      PROXY_FACTORY_ADDRESS,
      owner,
      proxyAccountAddress
    );

    const tx = await gnosisForwarder.createProxyContract();

    await owner.sendTransaction({ to: tx.to, data: tx.data });
    const code = await provider.getCode(proxyAccountAddress);

    expect(await gnosisForwarder.isContractDeployed()).to.be.true;

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

  it("Transfer 1 eth via the wallet contract to a random wallet address", async () => {
    const { provider, owner, gnosisSafeMaster } = await loadFixture(createSafe);

    const proxyAccountAddress = GnosisSafeForwarder.buildProxyAccountAddress(
      owner,
      owner.address
    );

    const gnosisForwarder = new GnosisSafeForwarder(
      ChainID.MAINNET,
      PROXY_FACTORY_ADDRESS,
      owner,
      proxyAccountAddress
    );

    const tx = await gnosisForwarder.createProxyContract();

    await owner.sendTransaction({ to: tx.to, data: tx.data });
    const code = await provider.getCode(proxyAccountAddress);

    expect(await gnosisForwarder.isContractDeployed()).to.be.true;

    const transferAmount = parseEther("1");
    await owner.sendTransaction({
      to: proxyAccountAddress,
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
    const { provider, owner } = await loadFixture(createSafe);

    const echoCon = await new EchoFactory(owner).deploy();

    const proxyAccountAddress = GnosisSafeForwarder.buildProxyAccountAddress(
      owner,
      owner.address
    );

    const gnosisForwarder = new GnosisSafeForwarder(
      ChainID.MAINNET,
      PROXY_FACTORY_ADDRESS,
      owner,
      proxyAccountAddress
    );

    const tx = await gnosisForwarder.createProxyContract();

    await owner.sendTransaction({ to: tx.to, data: tx.data });
    const code = await provider.getCode(proxyAccountAddress);

    expect(await gnosisForwarder.isContractDeployed()).to.be.true;

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
    const { provider, owner } = await loadFixture(createSafe);

    const counterCon = await new CounterFactory(owner).deploy();

    const proxyAccountAddress = GnosisSafeForwarder.buildProxyAccountAddress(
      owner,
      owner.address
    );

    const gnosisForwarder = new GnosisSafeForwarder(
      ChainID.MAINNET,
      PROXY_FACTORY_ADDRESS,
      owner,
      proxyAccountAddress
    );

    const tx = await gnosisForwarder.createProxyContract();

    await owner.sendTransaction({ to: tx.to, data: tx.data });
    const code = await provider.getCode(proxyAccountAddress);

    expect(await gnosisForwarder.isContractDeployed()).to.be.true;

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
    const { provider, owner } = await loadFixture(createSafe);

    const counterCon = await new CounterFactory(owner).deploy();

    const proxyAccountAddress = GnosisSafeForwarder.buildProxyAccountAddress(
      owner,
      owner.address
    );

    const gnosisForwarder = new GnosisSafeForwarder(
      ChainID.MAINNET,
      PROXY_FACTORY_ADDRESS,
      owner,
      proxyAccountAddress
    );

    const tx = await gnosisForwarder.createProxyContract();

    await owner.sendTransaction({ to: tx.to, data: tx.data });
    const code = await provider.getCode(proxyAccountAddress);

    expect(await gnosisForwarder.isContractDeployed()).to.be.true;

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
    const { owner } = await loadFixture(createSafe);

    const echoCon = await new EchoFactory(owner).deploy();

    const proxyAccountAddress = GnosisSafeForwarder.buildProxyAccountAddress(
      owner,
      owner.address
    );

    const gnosisForwarder = new GnosisSafeForwarder(
      ChainID.MAINNET,
      PROXY_FACTORY_ADDRESS,
      owner,
      proxyAccountAddress
    );

    // Let's send a transaction via Gnosis Safe
    const data = echoCon.interface.functions.sendMessage.encode(["hello"]);

    const minimalTx = await gnosisForwarder.signMetaTransaction({
      to: echoCon.address,
      data: data,
      value: 0,
    });

    const decodedTx = gnosisForwarder.decodeTx(minimalTx.data);

    expect(decodedTx._metaTx.to, "Sending to the echo contract").to.eq(
      echoCon.address
    );
    expect(decodedTx._metaTx.data, "Data for the echo contract").to.eq(data);
    const zero = new BigNumber(0);
    expect(zero.eq(decodedTx._metaTx.value), "Zero value sent").to.be.true;
    expect(decodedTx._metaTx.callType, "CALL type").to.eq(0);
    expect(
      decodedTx._replayProtectionAuthority,
      "Proxy account address manages the replay protection"
    ).to.eq(proxyAccountAddress);
    expect(
      decodedTx._replayProtection,
      "We cannot fetch the replay protection nonce, so it returns -1"
    ).to.eq("-1");
  }).timeout(50000);

  it("Decode a meta-transaction batch", async () => {
    const { owner } = await loadFixture(createSafe);

    const echoCon = await new EchoFactory(owner).deploy();

    const proxyAccountAddress = GnosisSafeForwarder.buildProxyAccountAddress(
      owner,
      owner.address
    );

    const gnosisForwarder = new GnosisSafeForwarder(
      ChainID.MAINNET,
      PROXY_FACTORY_ADDRESS,
      owner,
      proxyAccountAddress
    );

    // Let's send a transaction via Gnosis Safe
    const data = echoCon.interface.functions.sendMessage.encode(["hello"]);

    const toBatch = [
      {
        to: echoCon.address,
        data: data,
        value: new BigNumber(0),
      },
      {
        to: echoCon.address,
        data: data,
        value: new BigNumber(1),
      },
    ];
    const minimalTx = await gnosisForwarder.signMetaTransaction(toBatch);

    const decodedTx = gnosisForwarder.decodeBatchTx(minimalTx.data);

    for (let i = 0; i < decodedTx._metaTxList.length; i++) {
      expect(decodedTx._metaTxList[i].to, "Sending to the echo contract").to.eq(
        toBatch[i].to
      );
      expect(decodedTx._metaTxList[i].data, "Data for the echo contract").to.eq(
        toBatch[i].data
      );
      const zero = new BigNumber(0);
      expect(
        toBatch[i].value.eq(decodedTx._metaTxList[i].value),
        "Zero value sent"
      ).to.be.true;
      expect(decodedTx._metaTxList[i].callType, "CALL type").to.eq(0);
      expect(
        decodedTx._replayProtectionAuthority,
        "Proxy account address manages the replay protection"
      ).to.eq(proxyAccountAddress);
      expect(
        decodedTx._replayProtection,
        "We cannot fetch the replay protection nonce, so it returns -1"
      ).to.eq("-1");
    }
  }).timeout(50000);
});
