import { ethers } from "ethers";
import { RelayHubFactory, ProxyAccountDeployerFactory } from "..";
import { parseEther } from "ethers/utils";
import { MultiSendFactory } from "../typedContracts/MultiSendFactory";

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
(async () => {
  // Set up wallets & provider
  const { admin } = await setup();
  console.log("Admin wallet address: " + admin.address);

  const relayHubFactory = new RelayHubFactory(admin);
  const tx = relayHubFactory.getDeployTransaction();
  tx.gasPrice = parseEther("0.000000012");

  const request = await admin.sendTransaction(tx);

  const receipt = await request.wait(1);

  console.log("Relay hub: " + receipt.contractAddress);

  const proxyHubFactory = new ProxyAccountDeployerFactory(admin);
  const proxyTx = proxyHubFactory.getDeployTransaction();

  proxyTx.gasPrice = parseEther("0.000000012");
  const proxyRequest = await admin.sendTransaction(proxyTx);
  const proxyReceipt = await proxyRequest.wait(1);

  console.log("Proxy hub: " + proxyReceipt.contractAddress);

  const multiSendFactory = new MultiSendFactory(admin);
  const multiSend = multiSendFactory.getDeployTransaction();

  proxyTx.gasPrice = parseEther("0.000000012");
  const multiSendRequest = await admin.sendTransaction(multiSend);
  const multiSendReceipt = await multiSendRequest.wait(1);

  console.log("MultiSend: " + multiSendReceipt.contractAddress);

  console.log("Setup complete. Enjoy the competition.");
})().catch((e) => {
  console.log(e);
  // Deal with the fact the chain failed
});
