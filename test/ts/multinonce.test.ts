import "mocha";
import * as chai from "chai";
import { solidity, loadFixture } from "ethereum-waffle";
import { BigNumber, keccak256, defaultAbiCoder } from "ethers/utils";
import { mock, when, anything, instance } from "ts-mockito";

import { RelayHubFactory, RelayHub } from "../../src";
import { Provider } from "ethers/providers";
import { Wallet } from "ethers/wallet";
import { MultiNonce } from "../../src/ts/multinonce";

const expect = chai.expect;
chai.use(solidity);

async function createRelayHub(provider: Provider, [admin]: Wallet[]) {
  const relayHubFactory = new RelayHubFactory(admin);
  const relayHubCreationTx = relayHubFactory.getDeployTransaction();

  const relayHubCreation = await admin.sendTransaction(relayHubCreationTx);
  const result = await relayHubCreation.wait(1);

  const relayHub = relayHubFactory.attach(result.contractAddress!);
  return {
    relayHub,
    admin
  };
}

describe("Bitflip Module", () => {
  it("Replace-by-nonce (single queue) increments as expected", async () => {
    const { relayHub, admin } = await loadFixture(createRelayHub);

    const multinonce = new MultiNonce(relayHub, 1);

    const encodedReplayProtection = await multinonce.getEncodedReplayProtection(
      admin.address
    );

    const decodedReplayProtection = defaultAbiCoder.decode(
      ["uint", "uint"],
      encodedReplayProtection
    );

    expect(decodedReplayProtection[0].toString()).to.eq(new BigNumber("0"));
    expect(decodedReplayProtection[1].toString()).to.eq(new BigNumber("0"));
  }).timeout(50000);

  it("Single queue nonce increments sequentially as expected", async () => {
    const { relayHub, admin } = await loadFixture(createRelayHub);

    const multinonce = new MultiNonce(relayHub, 1);

    for (let i = 0; i < 25; i++) {
      const encodedReplayProtection = await multinonce.getEncodedReplayProtection(
        admin.address
      );
      const decodedReplayProtection = defaultAbiCoder.decode(
        ["uint", "uint"],
        encodedReplayProtection
      );

      expect(decodedReplayProtection[0].toString()).to.eq(new BigNumber("0"));
      expect(decodedReplayProtection[1].toString()).to.eq(new BigNumber(i));
    }
  }).timeout(50000);

  it("Multiple queues and each queue nonce increments sequentially as expected", async () => {
    const { relayHub, admin } = await loadFixture(createRelayHub);

    const NO_OF_QUEUES = 5;
    const multinonce = new MultiNonce(relayHub, NO_OF_QUEUES);

    // We'll have 10 queue (concurrent transactions)
    // Under the hood, it authorises a transaction for each queue in turn.

    for (let i = 0; i < 25; i++) {
      for (let j = 0; j < NO_OF_QUEUES; j++) {
        const encodedReplayProtection = await multinonce.getEncodedReplayProtection(
          admin.address
        );
        const decodedReplayProtection = defaultAbiCoder.decode(
          ["uint", "uint"],
          encodedReplayProtection
        );

        // We cycle through each queue
        expect(decodedReplayProtection[0].toString()).to.eq(new BigNumber(j)); // Queue
        expect(decodedReplayProtection[1].toString()).to.eq(new BigNumber(i)); // Index in Queue
      }
    }
  }).timeout(50000);

  it("Replay protection reads from contract for starting nonce.", async () => {
    const { admin } = await loadFixture(createRelayHub);

    const mockedRelayHub: RelayHub = mock(RelayHub);
    const relayHub: RelayHub = instance(mockedRelayHub);
    when(await mockedRelayHub.nonceStore(anything())).thenReturn(
      new BigNumber(0)
    );
    const NO_OF_QUEUES = 5;

    // Let's fake the contract to assume nonce is up to date.
    for (let j = 0; j < NO_OF_QUEUES; j++) {
      const onchainId = keccak256(
        defaultAbiCoder.encode(["address", "uint"], [admin.address, j])
      );
      when(await mockedRelayHub.nonceStore(onchainId)).thenReturn(
        new BigNumber(2)
      );
    }

    // Let's reset the replay protection and see if it can "remember"
    const multinonce = new MultiNonce(relayHub, NO_OF_QUEUES);

    // MultiNonce should pick up the expected index on-chain
    for (let i = 2; i < 5; i++) {
      for (let j = 0; j < NO_OF_QUEUES; j++) {
        const encodedReplayProtection = await multinonce.getEncodedReplayProtection(
          admin.address
        );
        const decodedReplayProtection = defaultAbiCoder.decode(
          ["uint", "uint"],
          encodedReplayProtection
        );

        // We cycle through each queue
        expect(decodedReplayProtection[0].toString()).to.eq(new BigNumber(j)); // Queue
        expect(decodedReplayProtection[1].toString()).to.eq(new BigNumber(i)); // Index in Queue
      }
    }
  }).timeout(50000);
});
