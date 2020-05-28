import "mocha";
import * as chai from "chai";
import { solidity, loadFixture } from "ethereum-waffle";

import { fnIt } from "@pisa-research/test-utils";
import {
  deployMetaTxContracts,
  MsgSenderExampleFactory,
  CounterFactory,
} from "../../src";
import { Provider } from "ethers/providers";
import { Wallet } from "ethers/wallet";
import { MultiSend } from "../../src/typedContracts/MultiSend";
import { MultiSender } from "../../src/ts/batch/MultiSend";
import { MULTI_SEND_ADDRESS } from "../../src/deployment/addresses";

const expect = chai.expect;
chai.use(solidity);

type multiSend = MultiSend["functions"];

async function deployContracts(
  provider: Provider,
  [admin, owner, sender]: Wallet[]
) {
  const { relayHubAddress } = await deployMetaTxContracts(admin);
  const msgSenderFactory = new MsgSenderExampleFactory(admin);
  const msgSenderCon = await msgSenderFactory.deploy(relayHubAddress);
  const counterCon = await new CounterFactory(admin).deploy();

  return {
    provider,
    admin,
    owner,
    sender,
    msgSenderCon,
    counterCon,
  };
}

describe("MultiSend", () => {
  fnIt<multiSend>(
    (a) => a.batch,
    "send a single transaction in the multisend batch",
    async () => {
      const { admin, msgSenderCon } = await loadFixture(deployContracts);

      const callData = msgSenderCon.interface.functions.test.encode([]);

      const multiSender = new MultiSender();

      const batched = multiSender.batch([
        { to: msgSenderCon.address, data: callData, revertOnFail: false },
      ]);

      const tx = admin.sendTransaction({
        to: batched.to,
        data: batched.data,
      });

      await expect(tx)
        .to.emit(msgSenderCon, msgSenderCon.interface.events.WhoIsSender.name)
        .withArgs(MULTI_SEND_ADDRESS);
    }
  );

  fnIt<multiSend>(
    (a) => a.batch,
    "send multiple transactions (to the same contract) in the multisend batch",
    async () => {
      const { admin, counterCon } = await loadFixture(deployContracts);

      const callData = counterCon.interface.functions.increment.encode([]);

      const multiSender = new MultiSender();

      const batched = multiSender.batch([
        { to: counterCon.address, data: callData, revertOnFail: true },
        { to: counterCon.address, data: callData, revertOnFail: true },
        { to: counterCon.address, data: callData, revertOnFail: true },
        { to: counterCon.address, data: callData, revertOnFail: true },
      ]);

      await admin.sendTransaction({
        to: batched.to,
        data: batched.data,
      });

      const counter = await counterCon.c();

      expect(counter).to.eq(4);
    }
  );

  fnIt<multiSend>(
    (a) => a.batch,
    "three transactions with CounterCon and one transaction with MsgSenderCon. Batch succeeds.",
    async () => {
      const { admin, counterCon, msgSenderCon } = await loadFixture(
        deployContracts
      );

      const msgSenderCallData = msgSenderCon.interface.functions.test.encode(
        []
      );
      const callData = counterCon.interface.functions.increment.encode([]);

      const multiSender = new MultiSender();

      const batched = multiSender.batch([
        { to: counterCon.address, data: callData, revertOnFail: true },
        {
          to: msgSenderCon.address,
          data: msgSenderCallData,
          revertOnFail: true,
        },
        { to: counterCon.address, data: callData, revertOnFail: true },
        { to: counterCon.address, data: callData, revertOnFail: true },
      ]);

      const tx = admin.sendTransaction({
        to: batched.to,
        data: batched.data,
      });

      await expect(tx)
        .to.emit(msgSenderCon, msgSenderCon.interface.events.WhoIsSender.name)
        .withArgs(MULTI_SEND_ADDRESS);

      const counter = await counterCon.c();

      expect(counter).to.eq(3);
    }
  );

  fnIt<multiSend>(
    (a) => a.batch,
    "one out of four transactions will revert to test revertIfFail=false, but the batch still succeeds.",
    async () => {
      const { admin, counterCon, msgSenderCon } = await loadFixture(
        deployContracts
      );

      const failCallData = msgSenderCon.interface.functions.willRevert.encode(
        []
      );
      const callData = counterCon.interface.functions.increment.encode([]);

      const multiSender = new MultiSender();

      const batched = multiSender.batch([
        { to: counterCon.address, data: callData, revertOnFail: true },
        {
          to: msgSenderCon.address,
          data: failCallData,
          revertOnFail: false,
        },
        { to: counterCon.address, data: callData, revertOnFail: true },
        { to: counterCon.address, data: callData, revertOnFail: true },
      ]);

      await admin.sendTransaction({
        to: batched.to,
        data: batched.data,
      });

      const counter = await counterCon.c();

      expect(counter).to.eq(3);
    }
  );

  fnIt<multiSend>(
    (a) => a.batch,
    "one out of four transactions will revert to test reverrtIfFail=true, the batch transaction fails.",
    async () => {
      const { admin, counterCon, msgSenderCon } = await loadFixture(
        deployContracts
      );

      const failCallData = msgSenderCon.interface.functions.willRevert.encode(
        []
      );
      const callData = counterCon.interface.functions.increment.encode([]);

      const multiSender = new MultiSender();

      const batched = multiSender.batch([
        { to: counterCon.address, data: callData, revertOnFail: true },
        {
          to: msgSenderCon.address,
          data: failCallData,
          revertOnFail: true,
        },
        { to: counterCon.address, data: callData, revertOnFail: true },
        { to: counterCon.address, data: callData, revertOnFail: true },
      ]);

      const tx = admin.sendTransaction({
        to: batched.to,
        data: batched.data,
      });

      await expect(tx).to.be.reverted;
    }
  );

  fnIt<multiSend>(
    (a) => a.batch,
    "all transactions fail with revertIfFail=false, but the batch transaction passes.",
    async () => {
      const { admin, msgSenderCon } = await loadFixture(deployContracts);

      const failCallData = msgSenderCon.interface.functions.willRevert.encode(
        []
      );

      const multiSender = new MultiSender();

      const batched = multiSender.batch([
        {
          to: msgSenderCon.address,
          data: failCallData,
          revertOnFail: false,
        },
        {
          to: msgSenderCon.address,
          data: failCallData,
          revertOnFail: false,
        },
        {
          to: msgSenderCon.address,
          data: failCallData,
          revertOnFail: false,
        },
        {
          to: msgSenderCon.address,
          data: failCallData,
          revertOnFail: false,
        },
      ]);
      const tx = await admin.sendTransaction({
        to: batched.to,
        data: batched.data,
      });

      const receipt = await tx.wait(1);

      expect(receipt.status).to.eq(1);
    }
  );
});
