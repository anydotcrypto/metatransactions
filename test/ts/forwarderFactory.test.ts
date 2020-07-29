import "mocha";
import * as chai from "chai";
import { solidity, loadFixture } from "ethereum-waffle";
import { BigNumber, defaultAbiCoder } from "ethers/utils";
import {
  RelayHubFactory,
  MsgSenderExampleFactory,
  ProxyAccountDeployerFactory,
  ProxyAccountForwarderFactory,
  RelayHubForwarderFactory,
  RelayHubForwarder,
  MultiNonceReplayProtection,
  BitFlipReplayProtection,
  deployMetaTxContracts,
} from "../../src";

import { Provider } from "ethers/providers";
import { Wallet } from "ethers/wallet";
import {
  ChainID,
  ReplayProtectionType,
  ForwarderFactory,
} from "../../src/ts/forwarders/forwarderFactory";
import { AddressZero } from "ethers/constants";

const expect = chai.expect;
chai.use(solidity);

async function createHubs(provider: Provider, [admin]: Wallet[]) {
  const {
    relayHubAddress,
    proxyAccountDeployerAddress,
  } = await deployMetaTxContracts(admin);

  const relayHub = new RelayHubFactory(admin).attach(relayHubAddress);
  const proxyDeployer = new ProxyAccountDeployerFactory(admin).attach(
    proxyAccountDeployerAddress
  );
  const msgSenderExample = await new MsgSenderExampleFactory(admin).deploy(
    relayHub.address
  );

  const proxyAccountsForwardersFactory = new ProxyAccountForwarderFactory();
  const relayHubForwardsFactory = new RelayHubForwarderFactory();

  return {
    relayHub,
    proxyDeployer,
    admin,
    msgSenderExample,
    proxyAccountsForwardersFactory,
    relayHubForwardsFactory,
  };
}

describe("Forwarder Factory", () => {
  it("Confirm the CHAINID values correspond to the various networks", async () => {
    expect(ChainID.MAINNET).to.eq(1);
    expect(ChainID.ROPSTEN).to.eq(3);
  }).timeout(50000);

  it("Create the RelayForwarder with Nonce ", async () => {
    const { relayHub, admin, msgSenderExample } = await loadFixture(createHubs);
    const proxyForwarder = new RelayHubForwarder(
      ChainID.MAINNET,
      admin,
      relayHub.address,
      new MultiNonceReplayProtection(1, admin, relayHub.address)
    );

    const callData = msgSenderExample.interface.functions.willRevert.encode([]);

    for (let i = 0; i < 10; i++) {
      const metaTx = await proxyForwarder.signMetaTransaction({
        to: msgSenderExample.address,
        data: callData,
      });
      const forwardParams = proxyForwarder.decodeTx(metaTx.data);

      const decodedReplayProtection = defaultAbiCoder.decode(
        ["uint", "uint"],
        forwardParams._replayProtection
      );
      expect(forwardParams._metaTx.data).to.eq(callData, "Calldata");
      expect(metaTx.to).to.eq(relayHub.address, "RelayHub address");
      expect(decodedReplayProtection[0]).to.eq(new BigNumber("0"), "Nonce1");
      expect(decodedReplayProtection[1]).to.eq(new BigNumber(i), "Nonce2");
      expect(forwardParams._replayProtectionAuthority).to.eq(
        "0x0000000000000000000000000000000000000000",
        "Multinonce replay protection"
      );
      expect(forwardParams._metaTx.to).to.eq(
        msgSenderExample.address,
        "Target contract"
      );
    }
  }).timeout(50000);

  it("Create the RelayForwarder with MultiNonce ", async () => {
    const { relayHub, admin, msgSenderExample } = await loadFixture(createHubs);
    const relayForwarder = new RelayHubForwarder(
      ChainID.MAINNET,
      admin,
      relayHub.address,
      new MultiNonceReplayProtection(30, admin, relayHub.address)
    );
    const callData = msgSenderExample.interface.functions.willRevert.encode([]);

    for (let i = 0; i < 10; i++) {
      const metaTx = await relayForwarder.signMetaTransaction({
        to: msgSenderExample.address,
        data: callData,
      });
      const forwardParams = relayForwarder.decodeTx(metaTx.data);

      const decodedReplayProtection = defaultAbiCoder.decode(
        ["uint", "uint"],
        forwardParams._replayProtection
      );

      expect(forwardParams._metaTx.data).to.eq(callData, "Calldata");
      expect(metaTx.to).to.eq(relayHub.address, "RelayHub address");
      expect(decodedReplayProtection[0], "Nonce1").to.eq(new BigNumber(i));
      expect(decodedReplayProtection[1], "Nonce2").to.eq(new BigNumber("0"));
      expect(forwardParams._replayProtectionAuthority).to.eq(
        "0x0000000000000000000000000000000000000000",
        "Multinonce replay protection"
      );
      expect(forwardParams._metaTx.to).to.eq(
        msgSenderExample.address,
        "Target contract"
      );
    }
  }).timeout(50000);

  it("Create the RelayForwarder with Bitflip ", async () => {
    const { relayHub, admin, msgSenderExample } = await loadFixture(createHubs);
    const bitflip = new BitFlipReplayProtection(admin, relayHub.address);
    const relayForwarder = new RelayHubForwarder(
      ChainID.MAINNET,
      admin,
      relayHub.address,
      bitflip
    );
    const callData = msgSenderExample.interface.functions.willRevert.encode([]);

    const metaTx = await relayForwarder.signMetaTransaction({
      to: msgSenderExample.address,
      data: callData,
    });
    const forwardParams = relayForwarder.decodeTx(metaTx.data);

    const decodedReplayProtection = defaultAbiCoder.decode(
      ["uint", "uint"],
      forwardParams._replayProtection
    );
    expect(forwardParams._metaTx.data).to.eq(callData, "Calldata");
    expect(metaTx.to).to.eq(relayHub.address, "RelayHub address");
    expect(decodedReplayProtection[0]).to.eq(bitflip.index, "Nonce1");
    expect(decodedReplayProtection[1]).to.eq(new BigNumber("1"), "Nonce2");
    expect(forwardParams._replayProtectionAuthority).to.eq(
      "0x0000000000000000000000000000000000000001",
      "Multinonce replay protection"
    );
    expect(forwardParams._metaTx.to).to.eq(
      msgSenderExample.address,
      "Target contract"
    );
  }).timeout(50000);

  it("Create the ProxyForwarder with Nonce ", async () => {
    const {
      admin,
      msgSenderExample,
      proxyAccountsForwardersFactory,
    } = await loadFixture(createHubs);
    const proxyForwarder = await proxyAccountsForwardersFactory.createNew(
      ChainID.MAINNET,
      ReplayProtectionType.NONCE,
      admin
    );
    const callData = msgSenderExample.interface.functions.willRevert.encode([]);

    for (let i = 0; i < 10; i++) {
      const metaTx = await proxyForwarder.signMetaTransaction({
        to: msgSenderExample.address,
        value: new BigNumber(10),
        data: callData,
      });
      const forwardParams = proxyForwarder.decodeTx(metaTx.data);

      const decodedReplayProtection = defaultAbiCoder.decode(
        ["uint", "uint"],
        forwardParams._replayProtection
      );
      expect(forwardParams._metaTx.data).to.eq(callData, "Calldata");
      expect(metaTx.to).to.eq(proxyForwarder.address, "RelayHub address");
      expect(decodedReplayProtection[0]).to.eq(new BigNumber("0"), "Nonce1");
      expect(decodedReplayProtection[1]).to.eq(new BigNumber(i), "Nonce2");
      expect(forwardParams._replayProtectionAuthority).to.eq(
        "0x0000000000000000000000000000000000000000",
        "Multinonce replay protection"
      );
      expect(forwardParams._metaTx.to).to.eq(
        msgSenderExample.address,
        "Target contract"
      );
      expect(forwardParams._metaTx.value).to.eq(new BigNumber(10));
    }
  }).timeout(50000);

  it("Create the ProxyForwarder with MultiNonce ", async () => {
    const {
      admin,
      msgSenderExample,
      proxyAccountsForwardersFactory,
    } = await loadFixture(createHubs);
    const proxyForwarder = await proxyAccountsForwardersFactory.createNew(
      ChainID.MAINNET,
      ReplayProtectionType.MULTINONCE,
      admin
    );
    const callData = msgSenderExample.interface.functions.willRevert.encode([]);

    for (let i = 0; i < 10; i++) {
      const metaTx = await proxyForwarder.signMetaTransaction({
        to: msgSenderExample.address,
        value: new BigNumber(10),
        data: callData,
      });
      const forwardParams = proxyForwarder.decodeTx(metaTx.data);

      const decodedReplayProtection = defaultAbiCoder.decode(
        ["uint", "uint"],
        forwardParams._replayProtection
      );
      expect(forwardParams._metaTx.data).to.eq(callData, "Calldata");
      expect(metaTx.to).to.eq(proxyForwarder.address, "RelayHub address");
      expect(decodedReplayProtection[0]).to.eq(new BigNumber(i), "Nonce1");
      expect(decodedReplayProtection[1]).to.eq(new BigNumber("0"), "Nonce2");
      expect(forwardParams._replayProtectionAuthority).to.eq(
        "0x0000000000000000000000000000000000000000",
        "Multinonce replay protection"
      );
      expect(forwardParams._metaTx.to).to.eq(
        msgSenderExample.address,
        "Target contract"
      );
      expect(forwardParams._metaTx.value).to.eq(new BigNumber(10));
    }
  }).timeout(50000);

  it("Create the ProxyForwarder with Bitflip ", async () => {
    const {
      admin,
      msgSenderExample,
      proxyAccountsForwardersFactory,
    } = await loadFixture(createHubs);
    const proxyForwarder = await proxyAccountsForwardersFactory.createNew(
      ChainID.MAINNET,
      ReplayProtectionType.BITFLIP,
      admin
    );
    const callData = msgSenderExample.interface.functions.willRevert.encode([]);

    const metaTx = await proxyForwarder.signMetaTransaction({
      to: msgSenderExample.address,
      value: new BigNumber(10),
      data: callData,
    });
    const forwardParams = proxyForwarder.decodeTx(metaTx.data);

    const decodedReplayProtection = defaultAbiCoder.decode(
      ["uint", "uint"],
      forwardParams._replayProtection
    );
    expect(forwardParams._metaTx.data).to.eq(callData, "Calldata");
    expect(metaTx.to).to.eq(proxyForwarder.address, "RelayHub address");
    // we dont test the bitflip here - but we shouldnt need to for this unit test
    expect(decodedReplayProtection[1]).to.eq(new BigNumber("1"), "Nonce2");
    expect(forwardParams._replayProtectionAuthority).to.eq(
      "0x0000000000000000000000000000000000000001",
      "Multinonce replay protection"
    );
    expect(forwardParams._metaTx.to).to.eq(
      msgSenderExample.address,
      "Target contract"
    );
    expect(forwardParams._metaTx.value).to.eq(new BigNumber(10));
  }).timeout(50000);
});

const doesCache = async <T extends ForwarderFactory<T2>, T2>(
  factory: T,
  chainId: ChainID,
  replayProtectionType: ReplayProtectionType,
  signer: Wallet
) => {
  const forwarder1 = await factory.create(
    chainId,
    replayProtectionType,
    signer
  );

  const forwarder2 = await factory.create(
    chainId,
    replayProtectionType,
    signer
  );

  expect(forwarder1).to.eq(forwarder2);
};

const doesNotCache = async <T>(
  factory: ForwarderFactory<T>,
  chainId1: ChainID,
  replayProtectionType1: ReplayProtectionType,
  signer1: Wallet,
  chainId2: ChainID,
  replayProtectionType2: ReplayProtectionType,
  signer2: Wallet
) => {
  const forwarder1 = await factory.create(
    chainId1,
    replayProtectionType1,
    signer1
  );

  const forwarder2 = await factory.create(
    chainId2,
    replayProtectionType2,
    signer2
  );

  expect(forwarder1).to.not.eq(forwarder2);
};

const getUser = async (provider: Provider, [user1, user2]: Wallet[]) => {
  return { user1, user2 };
};

describe("RelayHubForwarderFactory", () => {
  it("does cache on create", async () => {
    const { user1 } = await loadFixture(getUser);
    await doesCache(
      new RelayHubForwarderFactory(),
      ChainID.MAINNET,
      ReplayProtectionType.BITFLIP,
      user1
    );
  });

  it("does not cache across chains", async () => {
    const { user1 } = await loadFixture(getUser);
    await doesNotCache(
      new RelayHubForwarderFactory(),
      ChainID.MAINNET,
      ReplayProtectionType.BITFLIP,
      user1,
      ChainID.ROPSTEN,
      ReplayProtectionType.BITFLIP,
      user1
    );
  });

  it("does not cache across replay protections", async () => {
    const { user1 } = await loadFixture(getUser);
    await doesNotCache(
      new RelayHubForwarderFactory(),
      ChainID.ROPSTEN,
      ReplayProtectionType.BITFLIP,
      user1,
      ChainID.ROPSTEN,
      ReplayProtectionType.MULTINONCE,
      user1
    );
  });

  it("does not cache across wallets", async () => {
    const { user1, user2 } = await loadFixture(getUser);
    await doesNotCache(
      new RelayHubForwarderFactory(),
      ChainID.ROPSTEN,
      ReplayProtectionType.BITFLIP,
      user1,
      ChainID.ROPSTEN,
      ReplayProtectionType.BITFLIP,
      user2
    );
  });

  it("RelayHub does not cache proxy account", async () => {
    const { user1 } = await loadFixture(getUser);
    const forwarder1 = await new RelayHubForwarderFactory().create(
      ChainID.ROPSTEN,
      ReplayProtectionType.BITFLIP,
      user1
    );

    const forwarder2 = await new ProxyAccountForwarderFactory().create(
      ChainID.ROPSTEN,
      ReplayProtectionType.BITFLIP,
      user1
    );

    expect(forwarder1).to.not.eq(forwarder2);
  });
});

describe("ProxyAccountForwarderFactory", () => {
  it("does cache on create", async () => {
    const { user1 } = await loadFixture(getUser);
    await doesCache(
      new ProxyAccountForwarderFactory(),
      ChainID.MAINNET,
      ReplayProtectionType.BITFLIP,
      user1
    );
  });

  it("does not cache across chains", async () => {
    const { user1 } = await loadFixture(getUser);
    await doesNotCache(
      new ProxyAccountForwarderFactory(),
      ChainID.MAINNET,
      ReplayProtectionType.BITFLIP,
      user1,
      ChainID.ROPSTEN,
      ReplayProtectionType.BITFLIP,
      user1
    );
  });

  it("does not cache across replay protections", async () => {
    const { user1 } = await loadFixture(getUser);
    await doesNotCache(
      new ProxyAccountForwarderFactory(),
      ChainID.ROPSTEN,
      ReplayProtectionType.BITFLIP,
      user1,
      ChainID.ROPSTEN,
      ReplayProtectionType.MULTINONCE,
      user1
    );
  });

  it("does not cache across wallets", async () => {
    const { user1, user2 } = await loadFixture(getUser);
    await doesNotCache(
      new ProxyAccountForwarderFactory(),
      ChainID.ROPSTEN,
      ReplayProtectionType.BITFLIP,
      user1,
      ChainID.ROPSTEN,
      ReplayProtectionType.BITFLIP,
      user2
    );
  });
});
