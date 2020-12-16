# Gnosis Safe Forwarder

We assume you have set up your nodejs environment and you simply need to plug-in our library.

1. **Install**. You need to install the NPM pacakge:

```
npm i @anydotcrypto/metatransactions --save-dev
```

2. **Environment**. Decide which network to use.

You will need to import ChainID into your code:

```
import { ChainID } from "@anydotcrypto/metatransactions";
```

Our library currently supports MAINNET or ROPSTEN.

```
// Blockchain ID (Mainnet = 1)
ChainID.MAINNET;
ChainID.ROPSTEN;
ChainID.RINKEBY;
ChainID.KOVAN;
```

The Gnosis Safe library only supports NONCE replay protection. Check out our [wallet contracts](proxyAccounts) for more exotic replay protection.

3. Let's create the meta-transaction library with your preferred options!

To instantiate the Gnosis Safe forwarder:

```js
const signer = Wallet.Mnemonic("").connect(provider);
const gnosisForwarder = new GnosisSafeForwarder(
  ChainID.ROPSTEN,
  signer,
  signer.address
);
```

This links the signer's wallet to their gnosis safe contract.

Important: Our library can authorise a meta-transaction if the Gnosis Safe contract does not yet exist (e.g. not deployed). Using the [MultiSend](https://github.com/anydotcrypto/metatransactions/blob/master/src/contracts/ops/MultiSend.sol) contract, it is possible to meta-deploy the Gnosis Safe contract and then execute the first meta-transaction in a single Ethereum Transaction. So there is no waiting/setup process.

# You are now ready to authorise a meta-transaction!

We will show how to authorise a meta-transaction using the Gnosis Safe forwarder.

## Example Echo Contract

The [Echo smart contract](https://github.com/anydotcrypto/metatransactions/blob/master/src/contracts/ops/Echo.sol) is used for our example:

```js
pragma solidity ^0.6.2;
contract Echo {
    event Broadcast(address signer, string message);
    function submit(string memory _message) public
    {
        emit Broadcast(msg.sender, _message);
    }
}
```

## How to use the Gnosis Safe contract

The [full example](https://github.com/anydotcrypto/metatransactions/blob/master/example/gnosissafe/echo.ts) is available and it covers:

- Checking the gnosis safe contract exists before deploying it.
- Deploying the Echo Contract via the gnosis safe contract
- Sending a meta-transaction to the Echo Contract via the gnosis safe contract.

Let's set up our forwarder and signer:

```js
const user = Wallet.Mnemonic("");
const relayer = Wallet.Mnemonic("");
const gnosisForwarder = new GnosisSafeForwarder(
  ChainID.ROPSTEN,
  user,
  user.address
);
```

We can deploy the Gnosis Safe contract.

```js
const isGnosisSafeDeployed = await gnosisForwarder.isWalletDeployed();
if (!isGnosisSafeDeployed) {
  const minimalTx = await gnosisForwarder.getWalletDeployTransaction();

  // For our example we mimic the relayer API with a relayer wallet.
  const gnosisSafeTx = await relayer.sendTransaction({
    to: minimalTx.to,
    data: minimalTx.data,
  });

  // Wait 1 block confirmation
  const gnosisSafeReceipt = await gnosisSafeTx.wait(1);
}
```

Supply the following information:

- **To** contract's address (required)
- **Data** the function name and its arguments (required)
- **Value** to be sent (in wei) - (optional)

Once you have settled on the message to echo, you can use this code sample to authorise the meta-transaction:

```js
// Fetch the contract and the data.
const echo = new EchoFactory(user).attach("");
const data = echo.interface.functions.submit.encode(["hello"]);

// Sign the meta transaction & encode it.
const metaTx = await gnosisForwarder.signMetaTransaction({
  to: echo.address,
  value: "0",
  data: data,
});

const submitTicketTx = await relayer.sendTransaction({
  to: metaTx.to,
  data: metaTx.data,
});

const submitTicketReceipt = await submitTicketTx.wait(1);
```

Easy right? You have just deployed the gnosis safe contract and sent a meta-transaction via the gnosis safe contract. Our library has taken care of the replay protection & constructing the transaction data for you. As well, its essentially the same workflow as our [proxy contract](proxyAccounts.md) flow.

Well done!

# Gnosis Safe Functionality

We take this opportunity to cover each function in the library.

## Instantiate the forwarder

You can use the factory to set up a new forwarder. It requires you to select the ChainID. We use the ChainID in the contract address salt to fix the network replay attack problem with Gnosis Safe. **YOU WILL HAVE A DIFFERENT WALLET ADDRESS ON EVERY NETWORK.** It only supports NONCE replay protection.

```js
const gnosisForwarder = new GnosisSafeForwarder(
  ChainID.ROPSTEN,
  signer,
  signer.address
);
```

## Properties

Once you have instantiated the forwarder, then you can access the following properties:

```js
const gnosisSafeAddress = gnosisSafeForwarder.address;
const signer = gnosisSafeForwarder.signer;
```

In Gnosis Safe, there is a one-to-one mapping for the setup data that includes the signer's key used to create the gnosis safe. We use a basic setup of a single-signer gnosis safe with no pre-installed modules. The library will automatically compute the address and make it available via `gnosisSafeForwarder.address`. Furthermore, the `Signer` is accessible via `gnosisSafeForwarder.signer`.

## Deploying the Gnosis Safe Contract

There are two helper functions:

```
const isGnosisSafeDeployed = await gnosisSafeForwarder.isWalletDeployed();
const minimalTx = await gnosisSafeForwarder.getWalletDeployTransaction();
```

The former lets you check if the gnosis safe contract is already deployed. The latter prepares a meta-transaction that can be packed into an Ethereum Transaction to deploy the gnosis safe contract. Note the `MinimalTx` only contains the fields `to, data`.

## Authorising a meta-transaction.

There is a single function for authorising a meta-transaction:

```js
const echoAddress = "0x...";
const data = echoContract.interface.functions.sendMessage.encode([
  "any.sender is nice",
]);
const metaTx = await gnosisSafeForwarder.signMetaTransaction({
  to: echoAddress,
  data: data,
  value: "0",
});
```

It returns a `MinimalTx` that only contains the fields `to, data` which can be packed into an Ethereum Transaction. This takes care of preparing the replay protection & wrapping the call so it can be processed by the gnosis safe contract.

Note there is an additional `callType` field that can be used to decide if it is a `call` or a `delegatecall`. We only discuss call and advanced users can look at the contract on how to use delegatecall.

## Authorising a meta-deployment.

To deploy use the signMetaTransaction function but replace the `to` argument with a `salt`:

```js
const initCode = new EchoFactory(user).getDeployTransaction().data!;
const value = "0";
const salt = "0x123";
const metaDeploy = await gnosisSafeForwarder.signMetaTransaction({
  initCode,
  value,
  salt
});
```

The `signMetaTransaction` function prepares a `MinimalTx` for the deployment. Again it only contains a `to, value, data` that can be packed in the Ethereum Transaction. In reality, it is using `delegatecall` from the gnosis safe contract into a global deployer contract and then deploy the smart contract.

The `computeAddressForDeployedContract` computes the address for the contract. It just requires the `initCode` and the `salt` used for the deployment.

## Send a batch of meta-transactions

You need to prepare a list of transactions to use in the batch:

```js
const metaTxList = [
  {
    to: msgSenderCon.address,
    value: 0,
    data: data,
    revertOnFail: true,
  },
  {
    data: initCode,
    salt: "v0.1",
    value: 0,
  },
  {
    to: echoCon.address,
    value: 0,
    data: data,
    revertOnFail: false,
  },
];
```

An additional feature is `revertOnFail` which lets you decide if the entire batch of transactions should revert if the meta-transaction fails. Again, we omit `CallType` as it should only be used by advanced users and most meta-transactions only require the `.call` functionality.

Now you can batch the transactions:

```ts
const minimalTx = await gnosisSafeForwarder.signMetaTransaction(metaTxList);
```

The `MinimalTx` contains the fields `to, data` that can be packed into an Ethereum Transaction. Each meta-transaction is processed in order by the proxy account contract.

## Decoding a metatransaction

You can decode a metatransaction into it's consutituent parts by using the decodeTx or decodeBatchTx functions.

For a single tx:

```js
const echoAddress = "0x...";
const data = echoContract.interface.functions.sendMessage.encode([
  "any.sender is nice",
]);
const metaTx = await gnosisSafeForwarder.signMetaTransaction({
  to: echoAddress,
  data: data,
  value: "0",
});
const forwardFunctionArguments = gnosisSafeForwarder.decodeTx(metaTx.data);
```

Or for a batch tx:

```js
const echoAddress = "0x...";
const data = echoContract.interface.functions.sendMessage.encode([
  "any.sender is nice",
]);
const metaTx = await proxyAccount.signMetaTransaction([
  {
    to: echoAddress,
    data: data,
    value: "0",
  },
]);
const forwardFunctionArguments = proxyAccount.decodeBatchTx(metaTx.data);
```
