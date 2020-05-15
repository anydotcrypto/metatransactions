import "mocha";
import { expect } from "chai";
import { getCreate2Address, keccak256, toUtf8Bytes } from "ethers/utils";
import { deployerAddress } from "../../src/deployment/deployer";
import {
  VERSION,
  PROXY_ACCOUNT_DEPLOYER_SALT_STRING,
  RELAY_HUB_SALT_STRING,
  BASE_ACCOUNT_SALT_STRING,
  BASE_ACCOUNT_ADDRESS,
  RELAY_HUB_ADDRESS,
  PROXY_ACCOUNT_DEPLOYER_ADDRESS,
  MULTI_SEND_SALT_STRING,
  MULTI_SEND_ADDRESS,
} from "../../src/deployment/addresses";
import {
  ProxyAccountDeployerFactory,
  RelayHubFactory,
  ProxyAccountFactory,
  MultiNonceReplayProtection,
} from "../../src";
import { ContractFactory } from "ethers";
import { MultiSendFactory } from "../../src/typedContracts/MultiSendFactory";

const checkAddress = (
  saltString: string,
  contractFactory: ContractFactory,
  expectedAddress: string,
  fromAddress: string = deployerAddress
) => {
  const address = getCreate2Address({
    from: fromAddress,
    salt: keccak256(toUtf8Bytes(saltString)),
    initCode: contractFactory.getDeployTransaction().data,
  });
  expect(address).to.eq(expectedAddress);
};

// these tests serve as a reminder that if contract code changes, then the contracts
// need to be redployed and dependents updated
describe("Contract addresses", () => {
  it("ProxyAccountDeployer", () => {
    checkAddress(
      VERSION + "|" + PROXY_ACCOUNT_DEPLOYER_SALT_STRING,
      new ProxyAccountDeployerFactory(),
      PROXY_ACCOUNT_DEPLOYER_ADDRESS
    );
  });

  it("BaseAccount", () => {
    checkAddress(
      VERSION + "|" + BASE_ACCOUNT_SALT_STRING,
      new ProxyAccountFactory(),
      BASE_ACCOUNT_ADDRESS,
      PROXY_ACCOUNT_DEPLOYER_ADDRESS
    );
  });

  it("RelayHubForwarder", () => {
    checkAddress(
      VERSION + "|" + RELAY_HUB_SALT_STRING,
      new RelayHubFactory(),
      RELAY_HUB_ADDRESS
    );
  });

  it("MultiSend", () => {
    checkAddress(
      VERSION + "|" + MULTI_SEND_SALT_STRING,
      new MultiSendFactory(),
      MULTI_SEND_ADDRESS
    );
  });
});
