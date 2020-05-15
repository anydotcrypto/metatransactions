import { Wallet } from "ethers";

/**
 * Helper library to generate a wallet for the competition
 */
(async () => {
  let wallet = Wallet.createRandom();
  let randomMnemonic = wallet.mnemonic;

  console.log("Please fill in the USER_MNEMONIC in the example script");
  console.log("Wallet address: " + wallet.address);
  console.log("12-word seed: " + randomMnemonic);
})().catch((e) => {
  console.log(e);
  // Deal with the fact the chain failed
});
