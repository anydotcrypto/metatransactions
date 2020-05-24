import "mocha";
import * as chai from "chai";
import { solidity, loadFixture } from "ethereum-waffle";

import { fnIt } from "@pisa-research/test-utils";
import {
  deployMetaTxContracts,
  MsgSenderExampleFactory,
  DelegateDeployer,
  EchoFactory,
  DelegateDeployerFactory,
} from "../../src";
import { Provider } from "ethers/providers";
import { Wallet } from "ethers/wallet";
import {
  keccak256,
  defaultAbiCoder,
  getCreate2Address,
  solidityKeccak256,
  parseEther,
} from "ethers/utils";
const expect = chai.expect;
chai.use(solidity);

type delegateDeployer = DelegateDeployer["functions"];

async function setup(provider: Provider, [admin]: Wallet[]) {
  const { delegateDeployerAddress } = await deployMetaTxContracts(admin, true);
  const delegateDeployer = new DelegateDeployerFactory(admin).attach(
    delegateDeployerAddress
  );
  return {
    provider,
    admin,
    delegateDeployer,
  };
}

describe("DelegateDeployer", () => {
  fnIt<delegateDeployer>(
    (a) => a.deploy,
    "send the echo contract and execute a transaction",
    async () => {
      const { admin, delegateDeployer } = await loadFixture(setup);

      const initCode = new EchoFactory(admin).getDeployTransaction()
        .data! as string;

      const extraData = keccak256(
        defaultAbiCoder.encode(["string"], ["hello"])
      );
      const echoAddress = getCreate2Address({
        from: delegateDeployer.address,
        salt: solidityKeccak256(["bytes32"], [extraData]),
        initCode: initCode,
      });

      const deployTx = delegateDeployer.deploy(initCode, 0, extraData);

      await expect(deployTx)
        .to.emit(
          delegateDeployer,
          delegateDeployer.interface.events.Deployed.name
        )
        .withArgs(echoAddress);

      const echoContract = new EchoFactory(admin).attach(echoAddress);

      const tx = echoContract.sendMessage("hello");

      await expect(tx)
        .to.emit(echoContract, echoContract.interface.events.Broadcast.name)
        .withArgs("hello");
    }
  );

  fnIt<delegateDeployer>(
    (a) => a.deploy,
    "same echo contract twice, we should catch the revert message.",
    async () => {
      const { admin, delegateDeployer } = await loadFixture(setup);

      const initCode = new EchoFactory(admin).getDeployTransaction()
        .data! as string;

      const extraData = keccak256(
        defaultAbiCoder.encode(["string"], ["hello"])
      );

      const echoAddress = getCreate2Address({
        from: delegateDeployer.address,
        salt: solidityKeccak256(["bytes32"], [extraData]),
        initCode: initCode,
      });

      const deployTx = delegateDeployer.deploy(initCode, 0, extraData);

      await expect(deployTx)
        .to.emit(
          delegateDeployer,
          delegateDeployer.interface.events.Deployed.name
        )
        .withArgs(echoAddress);

      const deployTx2 = delegateDeployer.deploy(initCode, 0, extraData);

      await expect(deployTx2).to.be.revertedWith("CREATE2 failed to deploy.");
    }
  );

  fnIt<delegateDeployer>(
    (a) => a.deploy,
    "a contract with 1 eth, but fails as Echo Constructor is not payable.",
    async () => {
      const { admin, provider, delegateDeployer } = await loadFixture(setup);

      const initCode = new EchoFactory(admin).getDeployTransaction()
        .data! as string;

      const extraData = keccak256(
        defaultAbiCoder.encode(["string"], ["hello"])
      );

      const topup = parseEther("1");
      const deployTx = delegateDeployer.deploy(initCode, topup, extraData, {
        value: topup,
      });

      await expect(deployTx).to.be.revertedWith("CREATE2 failed to deploy.");
    }
  );

  fnIt<delegateDeployer>(
    (a) => a.deploy,
    "a contract with 1 eth and it passes.",
    async () => {
      const { admin, provider, delegateDeployer } = await loadFixture(setup);

      const initCode = new MsgSenderExampleFactory(admin).getDeployTransaction(
        admin.address
      ).data! as string;

      const extraData = keccak256(
        defaultAbiCoder.encode(["string"], ["hello"])
      );

      const msgSenderAddress = getCreate2Address({
        from: delegateDeployer.address,
        salt: solidityKeccak256(["bytes32"], [extraData]),
        initCode: initCode,
      });

      const topup = parseEther("1");
      const deployTx = delegateDeployer.deploy(initCode, topup, extraData, {
        value: topup,
      });

      await expect(deployTx)
        .to.emit(
          delegateDeployer,
          delegateDeployer.interface.events.Deployed.name
        )
        .withArgs(msgSenderAddress);

      const balance = await provider.getBalance(msgSenderAddress);
      expect(balance).to.eq(topup);
    }
  );

  fnIt<delegateDeployer>(
    (a) => a.deploy,
    "a contract with 1 eth, but fails due to lack of balance.",
    async () => {
      const { admin, provider, delegateDeployer } = await loadFixture(setup);

      const initCode = new MsgSenderExampleFactory(admin).getDeployTransaction(
        admin.address
      ).data! as string;

      const extraData = keccak256(
        defaultAbiCoder.encode(["string"], ["hello"])
      );

      const topup = parseEther("2");
      const deployTx = delegateDeployer.deploy(initCode, topup, extraData, {
        value: parseEther("1"),
      });

      await expect(deployTx).to.be.revertedWith("CREATE2 failed to deploy.");
    }
  );

  fnIt<delegateDeployer>(
    (a) => a.deploy,
    "a contract with 1 eth, but overly funded transaction & some coins are lost. (ONLY USE GLOBAL DEPLOYER WITH DELEGATECALL).",
    async () => {
      const { admin, provider, delegateDeployer } = await loadFixture(setup);

      const initCode = new MsgSenderExampleFactory(admin).getDeployTransaction(
        admin.address
      ).data! as string;

      const extraData = keccak256(
        defaultAbiCoder.encode(["string"], ["hello"])
      );

      const msgSenderAddress = getCreate2Address({
        from: delegateDeployer.address,
        salt: solidityKeccak256(["bytes32"], [extraData]),
        initCode: initCode,
      });

      const topup = parseEther("0.5");
      const deployTx = delegateDeployer.deploy(initCode, topup, extraData, {
        value: parseEther("1"),
      });

      await expect(deployTx)
        .to.emit(
          delegateDeployer,
          delegateDeployer.interface.events.Deployed.name
        )
        .withArgs(msgSenderAddress);

      const balance = await provider.getBalance(msgSenderAddress);
      expect(balance).to.eq(topup);

      const deployerBalance = await provider.getBalance(
        delegateDeployer.address!
      );
      expect(deployerBalance).to.eq(topup);
    }
  );
});
