import { Signer, Contract } from "ethers";
import { parseEther } from "ethers/utils";

// create2 factory exists at 0xce0042B868300000d44A59004Da54A005ffdcf9f on all networks
// there are other versions of this, see https://ethereum-magicians.org/t/erc-2470-singleton-factory/3933
export const deployerAddress = "0xce0042B868300000d44A59004Da54A005ffdcf9f";
const deployerABI = [
  {
    inputs: [
      { internalType: "bytes", name: "_initCode", type: "bytes" },
      { internalType: "bytes32", name: "_salt", type: "bytes32" },
    ],
    name: "deploy",
    outputs: [
      {
        internalType: "address payable",
        name: "createdContract",
        type: "address",
      },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
];

// method for deployment specified here: https://eips.ethereum.org/EIPS/eip-2470
const deployerRawTransaction =
  "0xf9016c8085174876e8008303c4d88080b90154608060405234801561001057600080fd5b50610134806100206000396000f3fe6080604052348015600f57600080fd5b506004361060285760003560e01c80634af63f0214602d575b600080fd5b60cf60048036036040811015604157600080fd5b810190602081018135640100000000811115605b57600080fd5b820183602082011115606c57600080fd5b80359060200191846001830284011164010000000083111715608d57600080fd5b91908080601f016020809104026020016040519081016040528093929190818152602001838380828437600092019190915250929550509135925060eb915050565b604080516001600160a01b039092168252519081900360200190f35b6000818351602085016000f5939250505056fea26469706673582212206b44f8a82cb6b156bfcc3dc6aadd6df4eefd204bc928a4397fd15dacf6d5320564736f6c634300060200331b83247000822470";
const deployerAmount = parseEther("0.0247");
/**
 * Address of the account that deploys the deployer
 */
const deployerDeployerAddress = "0xBb6e024b9cFFACB947A71991E386681B1Cd1477D";

/**
 * Deploys the deployer contract. Does nothing if the deployer contract has already been deployed
 * @param admin
 */
export const deployDeployer = async (admin: Signer) => {
  if (!admin.provider) throw new Error("Admin must be attached to a provider.");

  // check if the deployer exists, and if not then lets deploy it
  const code = await admin.provider!.getCode(deployerAddress);
  if (!code || code === "0x" || code === "0x0") {
    // first send funds to the deployer deployer address
    await (
      await admin.sendTransaction({
        to: deployerDeployerAddress,
        value: deployerAmount,
      })
    ).wait();

    // now execute the deployer transaction
    await (
      await admin.provider!.sendTransaction(deployerRawTransaction)
    ).wait();
  }

  return new Contract(deployerAddress, deployerABI, admin);
};
