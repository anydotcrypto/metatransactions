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
export const USER_MNEMONIC = "";

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
    process.exit(0);
  }

  const userMnemonicWallet = ethers.Wallet.fromMnemonic(USER_MNEMONIC);
  const user = userMnemonicWallet.connect(infuraProvider);
  return {
    user,
    provider: infuraProvider,
  };
}

(async () => {
  // Set up wallets & provider
  const { user, provider } = await setup();

  console.log("Wallet address: " + user.address);
  console.log(
    "Balance: " + formatEther(await provider.getBalance(user.address))
  );

  // First we need to fetch the proxy account contract library for this signer
  const proxyAccount = await new ProxyAccountForwarderFactory().createNew(
    ChainID.ROPSTEN,
    ReplayProtectionType.BITFLIP,
    user
  );

  const isProxyDeployed = await proxyAccount.isContractDeployed();
  console.log("Do we need to deploy a proxy account? " + !isProxyDeployed);

  if (!isProxyDeployed) {
    const deployProxy = await proxyAccount.createProxyContract();
    const proxyTx = await user.sendTransaction({
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
  const initCode = new EchoFactory(user).getDeployTransaction().data! as string;

  const metaDeploy = await proxyAccount.signAndEncodeMetaDeployment(
    initCode,
    0,
    "0x123"
  );

  const echoAddress = proxyAccount.buildDeployedContractAddress(
    initCode,
    "0x123"
  );

  console.log("Deploying echo contract to address " + echoAddress);
  const deployTx = await user.sendTransaction({
    to: metaDeploy.to,
    data: metaDeploy.data,
    gasLimit: 500000,
  });

  console.log(
    "Deploy echo contract: " +
      "https://ropsten.etherscan.io/tx/" +
      deployTx.hash
  );
  await deployTx.wait(1);

  // Lets META-TX our broadcast :)
  const echoContract = new EchoFactory(user).attach(echoAddress);
  const callData = echoContract.interface.functions.sendMessage.encode([
    "any.sender is nice",
  ]);
  const metaTx = await proxyAccount.signAndEncodeMetaTransaction({
    target: echoAddress,
    data: callData,
  });

  console.log("Sending our message to echo");
  const tx = await user.sendTransaction({
    to: metaTx.to,
    data: metaTx.data,
    gasLimit: 300000,
  });
  console.log(
    "Send echo broadcast: " + "https://ropsten.etherscan.io/tx/" + tx.hash
  );
  await tx.wait(1);

  const lastMessage = await echoContract.lastMessage();
  console.log("Message in Echo Contract: " + lastMessage);
})().catch((e) => {
  console.log(e);
  // Deal with the fact the chain failed
});
