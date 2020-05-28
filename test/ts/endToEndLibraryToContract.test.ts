import "mocha";
import * as chai from "chai";
import { solidity, loadFixture } from "ethereum-waffle";
import { BigNumber, defaultAbiCoder } from "ethers/utils";
import { fnIt } from "@pisa-research/test-utils";
import {
  RelayHubFactory,
  MsgSenderExampleFactory,
  RelayHub,
  MultiNonceReplayProtection,
  BitFlipReplayProtection,
  RelayHubForwarder,
  ProxyAccountDeployerFactory,
  ProxyAccount,
  ProxyAccountForwarder,
  deployMetaTxContracts,
} from "../../src";
import { Provider } from "ethers/providers";
import { Wallet } from "ethers/wallet";
import { ChainID } from "../../src/ts/forwarders/forwarderFactory";
import { flipBit } from "../utils/test-utils";

const expect = chai.expect;
chai.use(solidity);

let relayHubType: RelayHub;
type relayHubFunctions = typeof relayHubType.functions;

let proxyAccount: ProxyAccount;
type proxyAccountFunctions = typeof proxyAccount.functions;

async function setup(provider: Provider, [admin, owner, sender]: Wallet[]) {
  const relayHub = await new RelayHubFactory(admin).deploy();

  const { proxyAccountDeployerAddress } = await deployMetaTxContracts(admin);
  const proxyDeployer = new ProxyAccountDeployerFactory(admin).attach(
    proxyAccountDeployerAddress
  );

  return {
    provider,
    relayHub,
    proxyDeployer,
    owner,
    sender,
  };
}

describe("End to End Library to Contract", () => {
  fnIt<relayHubFunctions>(
    (a) => a.forward,
    "reset the forwarder 5 times and each time send 10 transactions. setting: relayhub & bitflip protection",
    async () => {
      const { relayHub, owner, sender } = await loadFixture(setup);

      // Reset the forwarder 5 times
      for (let j = 0; j < 5; j++) {
        const forwarder = new RelayHubForwarder(
          ChainID.MAINNET,
          owner,
          relayHub.address,
          new BitFlipReplayProtection(owner, relayHub.address)
        );
        const msgSenderCon = await new MsgSenderExampleFactory(sender).deploy(
          forwarder.address
        );
        const msgSenderCall = msgSenderCon.interface.functions.test.encode([]);

        // Send 10 transactions
        for (let i = 0; i < 10; i++) {
          // @ts-ignore
          const params = await forwarder.signMetaTransaction({
            to: msgSenderCon.address,
            data: msgSenderCall,
          });
          const flippedBit = flipBit(new BigNumber("0"), new BigNumber(i));
          const decoded = defaultAbiCoder.decode(
            ["uint", "uint"],
            params.replayProtection
          );

          // No point checking QueueNo, it will be a random number each time.
          expect(decoded[1]).to.eq(flippedBit);
          const minimalTx = await forwarder.encodeSignedMetaTransaction(params);
          const tx = sender.sendTransaction({
            to: minimalTx.to,
            data: minimalTx.data,
          });
          await expect(tx)
            .to.emit(
              msgSenderCon,
              msgSenderCon.interface.events.WhoIsSender.name
            )
            .withArgs(owner.address);
        }
      }
    }
  ).timeout("1000000");

  fnIt<proxyAccountFunctions>(
    (a) => a.forward,
    "reset the forwarder 5 times and each time send 10 transactions. setting: proxy account & bitflip replay protection",
    async () => {
      const { proxyDeployer, relayHub, owner, sender } = await loadFixture(
        setup
      );

      const proxyAccountAddress = ProxyAccountForwarder.buildProxyAccountAddress(
        owner.address
      );

      // Reset forwarder 5 times
      for (let j = 0; j < 5; j++) {
        const forwarder = new ProxyAccountForwarder(
          ChainID.MAINNET,
          proxyDeployer.address,
          owner,
          proxyAccountAddress,
          new BitFlipReplayProtection(owner, proxyAccountAddress)
        );

        const deployed = await forwarder.isContractDeployed();
        if (!deployed) {
          const minimalTx = await forwarder.createProxyContract();
          await owner.sendTransaction({
            to: minimalTx.to,
            data: minimalTx.data,
          });
        }

        const msgSenderCon = await new MsgSenderExampleFactory(sender).deploy(
          relayHub.address
        );
        const msgSenderCall = msgSenderCon.interface.functions.test.encode([]);

        // Send 10 transactions
        for (let i = 0; i < 10; i++) {
          // @ts-ignore
          const params = await forwarder.signMetaTransaction({
            to: msgSenderCon.address,
            value: new BigNumber("0"),
            data: msgSenderCall,
          });

          const flippedBit = flipBit(new BigNumber("0"), new BigNumber(i));
          const decoded = defaultAbiCoder.decode(
            ["uint", "uint"],
            params.replayProtection
          );

          // No point checking QueueNumber It will be random each time.
          expect(decoded[1]).to.eq(flippedBit);

          //@ts-ignore
          const minimalTx = await forwarder.encodeSignedMetaTransaction(params);
          const tx = sender.sendTransaction({
            to: minimalTx.to,
            data: minimalTx.data,
          });

          await expect(tx)
            .to.emit(
              msgSenderCon,
              msgSenderCon.interface.events.WhoIsSender.name
            )
            .withArgs(forwarder.address);
        }
      }
    }
  ).timeout("1000000");

  fnIt<relayHubFunctions>(
    (a) => a.forward,
    "reset the forwarder 5 times and each time send 10 transactions. setting: relayhub & nonce replay protection",
    async () => {
      const { relayHub, owner, sender } = await loadFixture(setup);
      let counter = 0;

      // Reset forwarder 5 times
      for (let j = 0; j < 5; j++) {
        const forwarder = new RelayHubForwarder(
          ChainID.MAINNET,
          owner,
          relayHub.address,
          new MultiNonceReplayProtection(1, owner, relayHub.address)
        );
        const msgSenderCon = await new MsgSenderExampleFactory(sender).deploy(
          forwarder.address
        );
        const msgSenderCall = msgSenderCon.interface.functions.test.encode([]);

        // Send 10 transactions.
        for (let i = 0; i < 10; i++) {
          // @ts-ignore
          const params = await forwarder.signMetaTransaction({
            to: msgSenderCon.address,
            data: msgSenderCall,
          });

          const decoded = defaultAbiCoder.decode(
            ["uint", "uint"],
            params.replayProtection
          );
          expect(decoded[1]).to.eq(counter);
          counter = counter + 1;
          const minimalTx = await forwarder.encodeSignedMetaTransaction(params);
          const tx = sender.sendTransaction({
            to: minimalTx.to,
            data: minimalTx.data,
          });
          await expect(tx)
            .to.emit(
              msgSenderCon,
              msgSenderCon.interface.events.WhoIsSender.name
            )
            .withArgs(owner.address);
        }
      }
    }
  ).timeout("1000000");

  fnIt<proxyAccountFunctions>(
    (a) => a.forward,
    "reset the forwarder 5 times and each time send 10 transactions. setting: proxy account & nonce replay protection",
    async () => {
      const { proxyDeployer, relayHub, owner, sender } = await loadFixture(
        setup
      );
      const proxyAccountAddress = ProxyAccountForwarder.buildProxyAccountAddress(
        owner.address
      );
      let counter = 0;

      // Reset the forwarder 5 times.
      for (let j = 0; j < 5; j++) {
        const forwarder = new ProxyAccountForwarder(
          ChainID.MAINNET,
          proxyDeployer.address,
          owner,
          proxyAccountAddress,
          new MultiNonceReplayProtection(1, owner, proxyAccountAddress)
        );

        const deployed = await forwarder.isContractDeployed();

        if (!deployed) {
          const minimalTx = await forwarder.createProxyContract();
          await owner.sendTransaction({
            to: minimalTx.to,
            data: minimalTx.data,
          });
        }
        const msgSenderCon = await new MsgSenderExampleFactory(sender).deploy(
          relayHub.address
        );
        const msgSenderCall = msgSenderCon.interface.functions.test.encode([]);

        // Send 10 transactions
        for (let i = 0; i < 10; i++) {
          // @ts-ignore
          const params = await forwarder.signMetaTransaction({
            to: msgSenderCon.address,
            value: new BigNumber("0"),
            data: msgSenderCall,
          });
          const decoded = defaultAbiCoder.decode(
            ["uint", "uint"],
            params.replayProtection
          );
          expect(decoded[0]).to.eq(0);
          expect(decoded[1]).to.eq(counter);
          counter = counter + 1;

          // @ts-ignore
          const minimalTx = await forwarder.encodeSignedMetaTransaction(params);
          const tx = sender.sendTransaction({
            to: minimalTx.to,
            data: minimalTx.data,
          });
          await expect(tx)
            .to.emit(
              msgSenderCon,
              msgSenderCon.interface.events.WhoIsSender.name
            )
            .withArgs(forwarder.address);
        }
      }
    }
  ).timeout("1000000");

  fnIt<proxyAccountFunctions>(
    (a) => a.forward,
    "reset forwarder 5 times. In each run, send 10 transactions using 4 queues. setting: proxy account & multinonce replay protection",
    async () => {
      const { proxyDeployer, relayHub, owner, sender } = await loadFixture(
        setup
      );
      const queues = 4;

      const proxyAccountAddress = ProxyAccountForwarder.buildProxyAccountAddress(
        owner.address
      );

      // Reset the forwarder 5 times
      for (let reset = 0; reset < 5; reset++) {
        const forwarder = new ProxyAccountForwarder(
          ChainID.MAINNET,
          proxyDeployer.address,
          owner,
          proxyAccountAddress,
          new MultiNonceReplayProtection(queues, owner, proxyAccountAddress)
        );

        const deployed = await forwarder.isContractDeployed();

        if (!deployed) {
          const minimalTx = await forwarder.createProxyContract();
          await owner.sendTransaction({
            to: minimalTx.to,
            data: minimalTx.data,
          });
        }

        const msgSenderCon = await new MsgSenderExampleFactory(sender).deploy(
          relayHub.address
        );
        const msgSenderCall = msgSenderCon.interface.functions.test.encode([]);

        // Send 10 transactions
        for (let i = 0; i < 10; i++) {
          // Iterate over each queue.
          for (let j = 0; j < queues; j++) {
            // @ts-ignore
            const params = await forwarder.signMetaTransaction({
              to: msgSenderCon.address,
              value: new BigNumber("0"),
              data: msgSenderCall,
            });
            const decoded = defaultAbiCoder.decode(
              ["uint", "uint"],
              params.replayProtection
            );

            expect(decoded[0]).to.eq(j);
            const resetCount = reset * 10;
            expect(decoded[1]).to.eq(i + resetCount);

            // @ts-ignore
            const minimalTx = await forwarder.encodeSignedMetaTransaction(
              params
            );
            const tx = sender.sendTransaction({
              to: minimalTx.to,
              data: minimalTx.data,
            });
            await expect(tx)
              .to.emit(
                msgSenderCon,
                msgSenderCon.interface.events.WhoIsSender.name
              )
              .withArgs(forwarder.address);
          }
        }
      }
    }
  ).timeout("1000000");

  fnIt<relayHubFunctions>(
    (a) => a.forward,
    "reset forwarder 5 times. In each run, send 10 transactions using 4 queues. setting: relayhub & multinonce protection",
    async () => {
      const { relayHub, owner, sender } = await loadFixture(setup);
      const queues = 4;

      // Reset the forwarder 5 times
      for (let reset = 0; reset < 5; reset++) {
        const forwarder = new RelayHubForwarder(
          ChainID.MAINNET,
          owner,
          relayHub.address,
          new MultiNonceReplayProtection(queues, owner, relayHub.address)
        );
        const msgSenderCon = await new MsgSenderExampleFactory(sender).deploy(
          forwarder.address
        );
        const msgSenderCall = msgSenderCon.interface.functions.test.encode([]);
        for (let i = 0; i < 10; i++) {
          for (let j = 0; j < queues; j++) {
            // @ts-ignore
            const params = await forwarder.signMetaTransaction({
              to: msgSenderCon.address,
              data: msgSenderCall,
            });

            const decoded = defaultAbiCoder.decode(
              ["uint", "uint"],
              params.replayProtection
            );
            expect(decoded[0]).to.eq(j);
            const resetCount = reset * 10;
            expect(decoded[1]).to.eq(i + resetCount);

            const minimalTx = await forwarder.encodeSignedMetaTransaction(
              params
            );
            const tx = sender.sendTransaction({
              to: minimalTx.to,
              data: minimalTx.data,
            });
            await expect(tx)
              .to.emit(
                msgSenderCon,
                msgSenderCon.interface.events.WhoIsSender.name
              )
              .withArgs(owner.address);
          }
        }
      }
    }
  ).timeout("1000000");
});
