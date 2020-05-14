import { Contract, ContractFactory, Signer } from "ethers";
import { RelayHubFactory, ProxyAccountDeployerFactory } from "..";
import { keccak256, toUtf8Bytes, getCreate2Address } from "ethers/utils";
import { MultiSendFactory } from "../typedContracts/MultiSendFactory";
import { deployerAddress, deployDeployer } from "./deployer";
import {
  RELAY_HUB_SALT_STRING,
  VERSION,
  PROXY_ACCOUNT_DEPLOYER_SALT_STRING,
  MULTI_SEND_SALT_STRING,
} from "./addresses";

async function deployContract(
  deployerContract: Contract,
  contractFactory: ContractFactory,
  salt: string
) {
  const deployTx = contractFactory.getDeployTransaction();
  const gas =
    (await contractFactory.signer.provider!.estimateGas(deployTx)).toNumber() *
    1.2;
  const deployResponse = await deployerContract.deploy(deployTx.data, salt, {
    gasLimit: gas,
  });
  await deployResponse.wait();
  return getCreate2Address({
    from: deployerAddress,
    salt,
    initCode: deployTx.data,
  });
}

export const deployMetaTxContracts = async (admin: Signer, logProgress: boolean = false) => {
  // deploy the deployer
  const deployerContract = await deployDeployer(admin);

  const relayHubFactory = new RelayHubFactory(admin);
  const relayHubSalt = keccak256(
    toUtf8Bytes(VERSION + "|" + RELAY_HUB_SALT_STRING)
  );
  const relayHubAddress = await deployContract(
    deployerContract,
    relayHubFactory,
    relayHubSalt
  );  
  logProgress && console.log("RelayHub address: " + relayHubAddress);

  const proxyDeployerFactory = new ProxyAccountDeployerFactory(admin);
  const proxyDeployerSalt = keccak256(
    toUtf8Bytes(VERSION + "|" + PROXY_ACCOUNT_DEPLOYER_SALT_STRING)
  );
  const proxyAddress = await deployContract(
    deployerContract,
    proxyDeployerFactory,
    proxyDeployerSalt
  );
  logProgress && console.log("ProxyAccountDeployer address: " + proxyAddress);

  const proxyDeployer = proxyDeployerFactory.attach(proxyAddress);
  const baseAccount = await proxyDeployer.baseAccount();
  logProgress && console.log("BaseAccount address: " + baseAccount);

  const multiSendFactory = new MultiSendFactory(admin);
  const multiSendSalt = keccak256(
    toUtf8Bytes(VERSION + "|" + MULTI_SEND_SALT_STRING)
  );
  const multiSendAddress = await deployContract(
    deployerContract,
    multiSendFactory,
    multiSendSalt
  );
  logProgress && console.log("MultiSend address: " + multiSendAddress);

  return {
      relayHubAddress,
      proxyAccountDeployerAddress: proxyAddress,
      baseAccountAddress: baseAccount,
      multiSendAddress: multiSendAddress
  }
};