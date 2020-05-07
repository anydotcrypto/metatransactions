import { ethers, Contract, ContractFactory } from "ethers";
import { RelayHubFactory, ProxyAccountDeployerFactory } from "..";
import { keccak256, toUtf8Bytes, getCreate2Address } from "ethers/utils";
import { MultiSendFactory } from "../typedContracts/MultiSendFactory";
import { deployerAddress, deployerABI } from "./deployer";

const VERSION = "v0.1.0";
const RELAY_HUB = "RELAY_HUB";
const PROXY_ACCOUNT_DEPLOYER = "PROXY_ACCOUNT_DEPLOYER";
const MULTI_SEND = "MULTI_SEND";

// addresses for the salts above
const proxyDeployerAddress = "0x2AaAc4B6Ec181AEF203221c718AfE87f358508B6";
const baseAccountAddress = "0x354ed262196d1d965ac3241412e932f28704e129";
const relayHubAddress = "0x0A6f799E5594C6c6e931a62FA6aF4f0d18c934d4";
const multiSendAddress = "0x87dd8Bc0E2389a6f110F5693E59F788cB1a58e9d";

export const ADMIN_MNEMONIC =
  "";
/**
 * Set up the provider and wallet
 */
async function setup() {
  const infuraProvider = new ethers.providers.InfuraProvider(
    "mainnet",
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
  const relayHubSalt = keccak256(toUtf8Bytes(VERSION + RELAY_HUB));
  const relayHubAddress = await deployContract(
    deployerContract,
    relayHubFactory,
    relayHubSalt
  );
  console.log("RelayHub address: " + relayHubAddress);

  const proxyDeployerFactory = new ProxyAccountDeployerFactory(admin);
  const proxyDeployerSalt = keccak256(
    toUtf8Bytes(VERSION + PROXY_ACCOUNT_DEPLOYER)
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
  const multiSendSalt = keccak256(toUtf8Bytes(VERSION + MULTI_SEND));
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
