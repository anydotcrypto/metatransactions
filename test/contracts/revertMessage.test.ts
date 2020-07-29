import "mocha";
import * as chai from "chai";
import { solidity, loadFixture } from "ethereum-waffle";
import { fnIt } from "@pisa-research/test-utils";
import {
  MsgSenderExampleFactory,
  RevertMessageTesterFactory,
  RevertMessageTester,
} from "../../src";
import { Provider } from "ethers/providers";
import { Wallet } from "ethers/wallet";

const expect = chai.expect;
chai.use(solidity);

type revertMessageFunctions = RevertMessageTester["functions"];

async function deployContracts(
  provider: Provider,
  [admin, owner, sender]: Wallet[]
) {
  const msgSenderFactory = new MsgSenderExampleFactory(admin);
  const msgSenderCon = await msgSenderFactory.deploy(owner.address);
  const revertMessage = await new RevertMessageTesterFactory(admin).deploy();

  return {
    provider,
    admin,
    owner,
    sender,
    msgSenderCon,
    revertMessage,
  };
}

describe("RevertMessage", () => {
  fnIt<revertMessageFunctions>(
    (a) => a.testCall,
    "test revert message with a reasonably sized message",
    async () => {
      const { msgSenderCon, revertMessage } = await loadFixture(
        deployContracts
      );

      const data = msgSenderCon.interface.functions.willRevert.encode([]);

      const tx = revertMessage.testCall(msgSenderCon.address, data);

      await expect(tx)
        .to.emit(revertMessage, revertMessage.interface.events.Revert.name)
        .withArgs("Will always revert");
    }
  );

  fnIt<revertMessageFunctions>(
    (a) => a.testCall,
    "test revert message with a really long message",
    async () => {
      const { msgSenderCon, revertMessage } = await loadFixture(
        deployContracts
      );

      const data = msgSenderCon.interface.functions.willRevertLongMessage.encode(
        []
      );

      const tx = revertMessage.testCall(msgSenderCon.address, data);

      await expect(tx)
        .to.emit(revertMessage, revertMessage.interface.events.Revert.name)
        .withArgs(
          "This is a really long revert message to make sure we can catch it. There are no hidden quirks by solidity."
        );
    }
  );

  fnIt<revertMessageFunctions>(
    (a) => a.testCall,
    "test revert message with no message",
    async () => {
      const { msgSenderCon, revertMessage } = await loadFixture(
        deployContracts
      );

      const data = msgSenderCon.interface.functions.willRevertNoMessage.encode(
        []
      );

      const tx = revertMessage.testCall(msgSenderCon.address, data);

      await expect(tx)
        .to.emit(revertMessage, revertMessage.interface.events.Revert.name)
        .withArgs("Transaction reverted silently");
    }
  );
});
