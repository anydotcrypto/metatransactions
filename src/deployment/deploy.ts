import { ethers, Contract, ContractFactory } from "ethers";
import { RelayHubFactory, ProxyAccountDeployerFactory } from "..";
import { keccak256, toUtf8Bytes, getCreate2Address } from "ethers/utils";
import { MultiSendFactory } from "../typedContracts/MultiSendFactory";
import { deployerAddress, deployerABI } from "./deployer";
import {
  RELAY_HUB_SALT_STRING,
  VERSION,
  PROXY_ACCOUNT_DEPLOYER_SALT_STRING,
  MULTI_SEND_SALT_STRING,
} from "./addresses";

export const ADMIN_MNEMONIC = "";
/**
 * Set up the provider and wallet
 */
async function setup() {
  const infuraProvider = new ethers.providers.InfuraProvider(
    "ropsten",
    "7333c8bcd07b4a179b0b0a958778762b"
  );

  const adminMnemonicWallet = ethers.Wallet.fromMnemonic(ADMIN_MNEMONIC);
  const admin = adminMnemonicWallet.connect(infuraProvider);
  return {
    admin,
    provider: infuraProvider,
  };
}

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

(async () => {
  // Set up wallets & provider
  const { admin } = await setup();
  console.log("Admin wallet address: " + admin.address);
  const deployerContract = new Contract(deployerAddress, deployerABI, admin);

  const relayHubFactory = new RelayHubFactory(admin);
  const relayHubSalt = keccak256(
    toUtf8Bytes(VERSION + "|" + RELAY_HUB_SALT_STRING)
  );
  const relayHubAddress = await deployContract(
    deployerContract,
    relayHubFactory,
    relayHubSalt
  );
  console.log("RelayHub address: " + relayHubAddress);

  const proxyDeployerFactory = new ProxyAccountDeployerFactory(admin);
  const proxyDeployerSalt = keccak256(
    toUtf8Bytes(VERSION + "|" + PROXY_ACCOUNT_DEPLOYER_SALT_STRING)
  );
  const proxyAddress = await deployContract(
    deployerContract,
    proxyDeployerFactory,
    proxyDeployerSalt
  );
  console.log("ProxyAccountDeployer address: " + proxyAddress);
  const proxyDeployer = proxyDeployerFactory.attach(proxyAddress);
  const baseAccount = await proxyDeployer.baseAccount();
  console.log("BaseAccount address: " + baseAccount);

  const multiSendFactory = new MultiSendFactory(admin);
  const multiSendSalt = keccak256(
    toUtf8Bytes(VERSION + "|" + MULTI_SEND_SALT_STRING)
  );
  const multiSendAddress = await deployContract(
    deployerContract,
    multiSendFactory,
    multiSendSalt
  );
  console.log("MultiSend address: " + multiSendAddress);
})().catch((e) => {
  console.log(e);
  // Deal with the fact the chain failed
});
