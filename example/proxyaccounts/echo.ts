import { ethers } from "ethers";
import { formatEther } from "ethers/utils";
import {
  ProxyAccountForwarderFactory,
  ChainID,
  ReplayProtectionType,
  EchoFactory,
} from "../../src";

// npm run generateSeed
// Top up the address and put the 12-word seed here
export const USER_MNEMONIC =
  "prize wear use ripple mask dose address space cost clinic topple brick";

/**
 * Set up the provider and wallet
 */
async function setup() {
  const infuraProvider = new ethers.providers.InfuraProvider(
    "ropsten",
    "7333c8bcd07b4a179b0b0a958778762b"
  );

  if (USER_MNEMONIC.length === 0) {
    console.log(
      "Please execute npm run generateSeed. \nTake the 12-word seed and fill in USER_MNEMONIC (top of file). \nTop up the address with some ropsten ETH and then try again!."
    );
    process.exit(0); // thanks to Sascha for pointing this out.
  }

  const adminMnemonicWallet = ethers.Wallet.fromMnemonic(USER_MNEMONIC);
  const admin = adminMnemonicWallet.connect(infuraProvider);
  return {
    admin,
    provider: infuraProvider,
  };
}

(async () => {
  // Set up wallets & provider
  const { admin, provider } = await setup();

  console.log("Wallet address: " + admin.address);
  console.log(
    "Balance: " + formatEther(await provider.getBalance(admin.address))
  );

  // First we need to deploy the proxy contract
  const proxyAccount = await new ProxyAccountForwarderFactory().createNew(
    ChainID.ROPSTEN,
    ReplayProtectionType.BITFLIP,
    admin
  );

  const isProxyDeployed = await proxyAccount.isContractDeployed();
  console.log("Do we need to deploy a proxy account? " + !isProxyDeployed);

  if (!isProxyDeployed) {
    const deployProxy = await proxyAccount.createProxyContract();
    const proxyTx = await admin.sendTransaction({
      to: deployProxy.to,
      data: deployProxy.data,
    });

    console.log(
      "Deploy proxy contract: " +
        "https://ropsten.etherscan.io/tx/" +
        proxyTx.hash
    );
    await proxyTx.wait(1);
  }

  // Lets META-DEPLOY the echo contract
  const initCode = new EchoFactory(admin).getDeployTransaction()
    .data! as string;

  const deploymentParams = await proxyAccount.signMetaDeployment(initCode);
  const metaDeployment = await proxyAccount.encodeSignedMetaDeployment(
    deploymentParams
  );
  const echoAddress = proxyAccount.buildDeployedContractAddress(
    deploymentParams
  );
  console.log("Deploying echo contract to address " + echoAddress);
  const deployTx = await admin.sendTransaction({
    to: deploymentParams.to,
    data: metaDeployment,
  });

  console.log(
    "Deploy echo contract: " +
      "https://ropsten.etherscan.io/tx/" +
      deployTx.hash
  );
  await deployTx.wait(1);

  // Lets META-TX our broadcast :)
  const echoContract = new EchoFactory(admin).attach(echoAddress);
  const callData = echoContract.interface.functions.sendMessage.encode([
    "any.sender is nice",
  ]);
  const minimalTx = await proxyAccount.signAndEncodeMetaTransaction({
    to: echoContract.address,
    data: callData,
  });

  console.log("Sending our message to echo");
  const metaTx = await admin.sendTransaction({
    to: minimalTx.to,
    data: minimalTx.data,
  });
  console.log(
    "Send echo broadcast: " + "https://ropsten.etherscan.io/tx/" + metaTx.hash
  );
  await metaTx.wait(1);

  const lastMessage = await echoContract.lastMessage();
  console.log("Message in Echo Contract: " + lastMessage);
})().catch((e) => {
  console.log(e);
  // Deal with the fact the chain failed
});
