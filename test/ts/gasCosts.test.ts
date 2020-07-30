import "mocha";
import * as chai from "chai";
import { solidity, loadFixture, deployContract } from "ethereum-waffle";
import {
  deployMetaTxContracts,
  ProxyFactoryFactory,
  GnosisSafeFactory,
  GnosisSafeForwarder,
  EchoFactory,
  CounterFactory,
  ProxyAccountForwarder,
  ProxyAccountForwarderFactory,
  Forwarder,
  ProxyAccountDeployCallData,
  RevertableProxyAccountCallData,
  RevertableProxyAccountDeployCallData,
  ProxyAccountCallData,
} from "../../src";

import { Provider } from "ethers/providers";
import { Wallet } from "ethers/wallet";
import {
  ChainID,
  ReplayProtectionType,
} from "../../src/ts/forwarders/forwarderFactory";
import {
  parseEther,
  BigNumber,
  getCreate2Address,
  keccak256,
} from "ethers/utils";
import { Echo } from "../../src/typedContracts/Echo";
import { providers } from "ethers";

const expect = chai.expect;
chai.use(solidity);

const txOverhead = "21000";

async function createSafe(
  provider: Provider,
  [admin, owner, sender]: Wallet[]
) {
  await deployMetaTxContracts(admin, false);

  return {
    provider,
    admin,
    owner,
    sender,
  };
}

interface GasTable {
  name: string;
  deploy: number;
  echoDeploy: number;
  firstTransaction: number;
  secondTransaction: number;
  tenTransactionsAvg: number;
  oneHundredTransactionsAvg: number;
}

async function deployWalletContract(
  owner: Wallet,
  forwarder: any
): Promise<number> {
  const deployProxy = await forwarder.getWalletDeployTransaction(); // Does not exist on Forwarder, so using any for now

  const tx = await owner.sendTransaction({
    to: deployProxy.to,
    data: deployProxy.data,
  });

  const deployReceipt = await tx.wait(1);
  expect(await forwarder.isWalletDeployed()).to.be.true;

  return deployReceipt.gasUsed!.sub(txOverhead).toNumber();
}

async function metaDeployEcho(owner: Wallet, forwarder: any): Promise<number> {
  const initCode = new EchoFactory(owner).getDeployTransaction()
    .data! as string;

  // Deploy the proxy using CREATE2
  const minimalTx = await forwarder.signMetaTransaction({
    data: initCode,
    value: 0,
    salt: "0x123",
  });

  const tx = await owner.sendTransaction({
    to: minimalTx.to,
    data: minimalTx.data,
  });

  const deployReceipt = await tx.wait(1);
  const echoAddress = getCreate2Address({
    from: forwarder.address,
    salt: keccak256("0x123"),
    initCode: initCode,
  });
  expect(await owner.provider.getCode(echoAddress)).not.eq("0x");

  return deployReceipt.gasUsed!.sub(txOverhead).toNumber();
}

async function sendOneTransactionNoTarget(
  owner: Wallet,
  forwarder: any
): Promise<number> {
  // Deploy the proxy using CREATE2
  const minimalTx = await forwarder.signMetaTransaction({
    to: owner.address,
    value: 0,
  });

  const tx = await owner.sendTransaction({
    to: minimalTx.to,
    data: minimalTx.data,
  });

  const receipt = await tx.wait(1);
  return receipt.gasUsed!.sub(txOverhead).toNumber();
}

async function sendTenTransactionNoTarget(
  owner: Wallet,
  forwarder: any
): Promise<number> {
  let avg = 0;
  for (let i = 0; i < 10; i++) {
    avg = avg + (await sendOneTransactionNoTarget(owner, forwarder));
  }
  return avg / 10;
}

async function sendOneHundredTransactionsNoTarget(
  owner: Wallet,
  forwarder: any
): Promise<number> {
  let avg = 0;

  for (let i = 0; i < 10; i++) {
    avg = avg + (await sendTenTransactionNoTarget(owner, forwarder));
  }

  return avg / 10;
}

describe("GasCosts", () => {
  it("Compute gas costs for proxy account & gnosis safe.", async () => {
    const { admin, owner } = await loadFixture(createSafe);

    // Deploy Gnosis Safe and a Proxy Contract (Bitflip)
    const gnosisForwarder = new GnosisSafeForwarder(
      ChainID.MAINNET,
      owner,
      owner.address
    );

    const bitFlipProxyForwarder = await new ProxyAccountForwarderFactory().create(
      ChainID.MAINNET,
      ReplayProtectionType.BITFLIP,
      owner
    );

    const multiNonceProxyForwarder = await new ProxyAccountForwarderFactory().create(
      ChainID.MAINNET,
      ReplayProtectionType.MULTINONCE,
      admin
    );

    const gnosisGas: GasTable = {
      name: "GnosisSafe",
      deploy: await deployWalletContract(owner, gnosisForwarder),
      firstTransaction: await sendOneTransactionNoTarget(
        owner,
        gnosisForwarder
      ),
      secondTransaction: await sendOneTransactionNoTarget(
        owner,
        gnosisForwarder
      ),
      tenTransactionsAvg: await sendTenTransactionNoTarget(
        owner,
        gnosisForwarder
      ),
      oneHundredTransactionsAvg: await sendOneHundredTransactionsNoTarget(
        owner,
        gnosisForwarder
      ),
      echoDeploy: await metaDeployEcho(owner, gnosisForwarder),
    };

    const bitflipProxyGas: GasTable = {
      name: "Proxy-Bitflip",
      deploy: await deployWalletContract(owner, bitFlipProxyForwarder),
      firstTransaction: await sendOneTransactionNoTarget(
        owner,
        bitFlipProxyForwarder
      ),
      secondTransaction: await sendOneTransactionNoTarget(
        owner,
        bitFlipProxyForwarder
      ),
      tenTransactionsAvg: await sendTenTransactionNoTarget(
        owner,
        bitFlipProxyForwarder
      ),
      oneHundredTransactionsAvg: await sendOneHundredTransactionsNoTarget(
        owner,
        bitFlipProxyForwarder
      ),
      echoDeploy: await metaDeployEcho(owner, bitFlipProxyForwarder),
    };

    const multiNonceProxyGas: GasTable = {
      name: "Proxy-MultiNonce",
      deploy: await deployWalletContract(owner, multiNonceProxyForwarder),
      firstTransaction: await sendOneTransactionNoTarget(
        owner,
        multiNonceProxyForwarder
      ),
      secondTransaction: await sendOneTransactionNoTarget(
        owner,
        multiNonceProxyForwarder
      ),
      tenTransactionsAvg: await sendTenTransactionNoTarget(
        owner,
        multiNonceProxyForwarder
      ),
      oneHundredTransactionsAvg: await sendOneHundredTransactionsNoTarget(
        owner,
        multiNonceProxyForwarder
      ),
      echoDeploy: await metaDeployEcho(owner, multiNonceProxyForwarder),
    };

    console.table([gnosisGas, bitflipProxyGas, multiNonceProxyGas]);
  }).timeout(100000);
});
