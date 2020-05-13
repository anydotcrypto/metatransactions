// create2 factory exists at 0xce0042B868300000d44A59004Da54A005ffdcf9f on all networks
// there are other versions of this, see https://ethereum-magicians.org/t/erc-2470-singleton-factory/3933
export const deployerAddress = "0xce0042B868300000d44A59004Da54A005ffdcf9f"
export const deployerABI = [{"inputs":[{"internalType":"bytes","name":"_initCode","type":"bytes"},{"internalType":"bytes32","name":"_salt","type":"bytes32"}],"name":"deploy","outputs":[{"internalType":"address payable","name":"createdContract","type":"address"}],"stateMutability":"nonpayable","type":"function"}]