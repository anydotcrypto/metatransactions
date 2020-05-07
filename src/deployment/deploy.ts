import { ethers, Contract, ContractFactory } from "ethers";
import { RelayHubFactory, ProxyAccountDeployerFactory } from "..";
import { parseEther, keccak256, toUtf8Bytes } from "ethers/utils";
import { MultiSendFactory } from "../typedContracts/MultiSendFactory";
import { deployerAddress, deployerABI } from "./deployer";

const VERSION = "v0.1.0";
const RELAY_HUB = "RELAY_HUB";
const PROXY_ACCOUNT_DEPLOYER = "PROXY_ACCOUNT_DEPLOYER";
const MULTI_SEND = "MULTI_SEND";

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
  const deployResponse = await deployerContract.deploy(deployTx.data, salt, {
    gasPrice: parseEther("0.000000012"),
  });
  const receipt = await deployResponse.wait();
  return receipt.contractAddress;
}

(async () => {
  // Set up wallets & provider
  const { admin } = await setup();
  console.log("Admin wallet address: " + admin.address);
  const deployerContract = new Contract(deployerAddress, deployerABI, admin);

  const relayHubFactory = new RelayHubFactory(admin);
  const relayHubSalt = keccak256(toUtf8Bytes(VERSION + RELAY_HUB));
  console.log(relayHubSalt);
  const relayHubAddress = await deployContract(deployerContract, relayHubFactory, relayHubSalt);
  console.log("Relay hub: " + relayHubAddress);

  const proxyDeployerFactory = new ProxyAccountDeployerFactory(admin);
  const proxyDeployerSalt = keccak256(toUtf8Bytes(VERSION + PROXY_ACCOUNT_DEPLOYER));
  const proxyAccountDeployerAddress = await deployContract(deployerContract, proxyDeployerFactory, proxyDeployerSalt);
  console.log("Proxy account deployer: " + proxyAccountDeployerAddress);

  const multiSendFactory = new MultiSendFactory(admin);
  const multiSendSalt = keccak256(toUtf8Bytes(VERSION + MULTI_SEND));
  const multiSendAddress = await deployContract(deployerContract, multiSendFactory, multiSendSalt)
  console.log("MultiSend: " + multiSendAddress);

  console.log("Setup complete. Enjoy the competition.");
})().catch((e) => {
  console.log(e);
  // Deal with the fact the chain failed
});
