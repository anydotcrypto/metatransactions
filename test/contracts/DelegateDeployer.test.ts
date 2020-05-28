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
  CallWrapperFactory,
} from "../../src";
import { Provider } from "ethers/providers";
import { Wallet } from "ethers/wallet";
import {
  keccak256,
  defaultAbiCoder,
  getCreate2Address,
  parseEther,
} from "ethers/utils";
const expect = chai.expect;
chai.use(solidity);

type delegateDeployer = DelegateDeployer["functions"];

async function setup(provider: Provider, [admin]: Wallet[]) {
  const { delegateDeployerAddress } = await deployMetaTxContracts(admin);
  const delegateDeployer = new DelegateDeployerFactory(admin).attach(
    delegateDeployerAddress
  );

  const callWrapper = await new CallWrapperFactory(admin).deploy();
  return {
    provider,
    admin,
    delegateDeployer,
    callWrapper,
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

      const salt = keccak256(defaultAbiCoder.encode(["string"], ["hello"]));
      const echoAddress = getCreate2Address({
        from: delegateDeployer.address,
        salt: salt,
        initCode: initCode,
      });

      const deployTx = delegateDeployer.deploy(initCode, 0, salt);

      await deployTx;

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

      const salt = keccak256(defaultAbiCoder.encode(["string"], ["hello"]));

      const echoAddress = getCreate2Address({
        from: delegateDeployer.address,
        salt: salt,
        initCode: initCode,
      });

      const deployTx = delegateDeployer.deploy(initCode, 0, salt);

      await deployTx;

      const deployTx2 = delegateDeployer.deploy(initCode, 0, salt);

      await expect(deployTx2).to.be.revertedWith("CREATE2 failed to deploy.");
    }
  );

  fnIt<delegateDeployer>(
    (a) => a.deploy,
    "a contract with 1 eth, but fails as Echo Constructor is not payable.",
    async () => {
      const { admin, callWrapper, delegateDeployer } = await loadFixture(setup);

      const initCode = new EchoFactory(admin).getDeployTransaction()
        .data! as string;

      const extraData = keccak256(
        defaultAbiCoder.encode(["string"], ["hello"])
      );
      const topup = parseEther("1");

      await admin.sendTransaction({ to: callWrapper.address, value: topup });

      const data = delegateDeployer.interface.functions.deploy.encode([
        initCode,
        topup,
        extraData,
      ]);

      const deployTx = callWrapper.delegateCall(delegateDeployer.address, data);

      await expect(deployTx)
        .to.emit(callWrapper, callWrapper.interface.events.Revert.name)
        .withArgs("CREATE2 failed to deploy.");
    }
  );

  fnIt<delegateDeployer>(
    (a) => a.deploy,
    "a contract with 1 eth and it passes.",
    async () => {
      const {
        admin,
        provider,
        delegateDeployer,
        callWrapper,
      } = await loadFixture(setup);

      const initCode = new MsgSenderExampleFactory(admin).getDeployTransaction(
        callWrapper.address
      ).data! as string;

      const salt = keccak256(defaultAbiCoder.encode(["string"], ["hello"]));

      const msgSenderAddress = getCreate2Address({
        from: callWrapper.address,
        salt: salt,
        initCode: initCode,
      });

      const topup = parseEther("1");

      const data = delegateDeployer.interface.functions.deploy.encode([
        initCode,
        topup,
        salt,
      ]);

      await callWrapper.delegateCall(delegateDeployer.address, data, {
        value: topup,
      });
      const balance = await provider.getBalance(msgSenderAddress);
      expect(balance).to.eq(topup);

      const msgSenderExample = new MsgSenderExampleFactory(admin).attach(
        msgSenderAddress
      );

      await expect(msgSenderExample.test())
        .to.emit(
          msgSenderExample,
          msgSenderExample.interface.events.WhoIsSender.name
        )
        .withArgs(admin.address);
    }
  );

  fnIt<delegateDeployer>(
    (a) => a.deploy,
    "a contract with 1 eth, but fails due to lack of balance.",
    async () => {
      const {
        admin,
        provider,
        delegateDeployer,
        callWrapper,
      } = await loadFixture(setup);

      const initCode = new MsgSenderExampleFactory(admin).getDeployTransaction(
        admin.address
      ).data! as string;

      const salt = keccak256(defaultAbiCoder.encode(["string"], ["hello"]));

      const topup = parseEther("2");
      const data = delegateDeployer.interface.functions.deploy.encode([
        initCode,
        topup,
        salt,
      ]);
      const val = parseEther("1");
      const tx = callWrapper.delegateCall(delegateDeployer.address, data, {
        value: val,
        gasLimit: 500000,
      });

      await expect(tx)
        .to.emit(callWrapper, callWrapper.interface.events.Revert.name)
        .withArgs("CREATE2 failed to deploy.");
    }
  );
});
