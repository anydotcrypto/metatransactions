import { Wallet } from "ethers";

/**
 * Helper library to generate a wallet for the competition
 */
(async () => {
  let wallet = Wallet.createRandom();
  let randomMnemonic = wallet.mnemonic;

  console.log("Please keep both safe for the competition");
  console.log("Wallet address: " + wallet.address);
  console.log("12-word seed: " + randomMnemonic);
})().catch((e) => {
  console.log(e);
  // Deal with the fact the chain failed
});
