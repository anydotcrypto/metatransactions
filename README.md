# A Minimal Meta-Transaction Library

Ethereum transaction's intertwine the identity of who paid for the transaction (gas.payer) and who wants to execute a command (msg.sender). As a result, it is **not straight forward for Alice to pay the gas fee on behalf of Bob** who wants to execute a command in a smart contract. Until it is fixed at the platform level, then Alice and Bob must adopt a meta-transaction standard to support this functionality (e.g. transaction infrastructure as a service in a non-custodial manner).

There are two approaches:

- **Proxy contracts:** All transactions for the user are sent via a proxy contract and it is compatible with all existing smart contracts.
- **\_msgSender():** All transactions are sent via a global RelayHub.sol contract and the target contract must support the standard which requires it to replace msg.sender with \_msgSender(). It is only compatible with contracts that have upgraded to use the standard.

We have put together this meta-transaction library to support both approaches. We hope it will benefit the community in the following ways:

- **Ease of adoption:** All new smart contracts can support meta-transactions without handling replay protection (e.g. the permit() standard).
- **Global RelayHub:** Our minimal RelayHub.sol can be a candidate for the hard-coded RelayHub in the \_msgSender() standard.
- **Single client library:** There are several libraries for constructing and signing transactions, but more often than not it is mixed up with the application logic. This repository is designed to become a single standard any project can adopt.

Finally, the ultimate goal is to make it easier for developers to tap into third party relayer APIs that focus on getting transactions in the blockchain.

## Getting started

We assume you have already set up your environment and you simply need to plug-in our library.

1. You need to install the NPM pacakge:

```
npm i @anydotcrypto/metatransactions --save-dev
```

2. You need to import the package into your file:

```
import { ChainID, ReplayProtectionType, ForwarderFactory } from "@anydotcrypto/metatransactions/dist";
```

3. You need to decide which the network, replay protection, and the msg.sender solution.

We have support for two networks:

```
ChainID.MAINNET
ChainID.ROPSTEN
```

Our library contains three types of replay protection (and more in-depth information can be [found here](https://github.com/PISAresearch/metamask-comp)):

- **Replace-by-nonce**: Same as Ethereum, it increments a nonce for every new transaction.
- **Multinonce:** There are multiple replace-by-nonce queues, so it supports up to N concurrent transactions at any time.
- **Bitflip:** There is no queue and all transactions are processed out of order (e.g. batch withdrawals).

The enumeration is simpe:

```
ReplayProtectionType.BITFLIP // Always out-of-order & concurrent
ReplayProtectionType.MULTINONCE // N queues
ReplayProtectionType.NONCE // Single queue
```

For the msg.sender solution, we cover [ProxyAccountFactory vs RelayHub](https://github.com/anydotcrypto/metatransactions#proxyhub-vs-relayhub) later in the README. If you are unsure which one to use, then we recommend `ContractType.PROXYACCOUNTDEPLOYER` as it works for all existing contracts. Essentially, each user has a minimal proxy account contract and their meta-transaction is sent via the proxy. The target's msg.sender is the proxy contract's address.

4. Time to instantiate the forwarder library!

If you want to use Proxy Accounts:

```
const signer = Wallet.Mnemonic("");
const concurrency = 10;
const forwarder = ForwarderFactory.getProxyForwarder(ChainID.MAINNET, ReplayProtectionType.MULTINONCE, signer);
```

The above option configures the proxy accounts to use multi-nonce replay protection (with 30 nonce queues). If you want all transactions to be processed in the transaction by order, then just set `ReplayProtectionType.NONCE`.

If you want to use the RelayHub:

```
const signer = wallet.Mnemonic("");
const forwarder = ForwarderFactory.getRelayHubForwarder(ChainID.MAINNET, ReplayProtectType.BITFLIP, signer);
```

The above configures the relay hub to use the bitflip replay protection. Bitflip supports an _unlimited number of concurrent transactions_ which is useful for batch withdrawals. It does not support ordered transactions, so use replace-by-nonce if you require ordering.

5. You are now ready to authorise a meta-transaction using the ForwarderFactory.

```
const user = Wallet.fromMnemonic("");
const echo = new EchoFactory(user).attach("");
const callData = echo.interface.functions.broadcastMessage.encode(["to the moon"]);
const value = new BigNumber("0");

const forwarder = ForwarderFactory.getProxyForwarder(ChainID.MAINNET, ReplayProtectionType.MULTINONCE, signer);
const data = {target: echo.address, value: value, callData: callData}; // Explicit tutorial
const params = await forwarder.signMetaTransaction({target: echo.address, value, data}) ;
```

The forwarder just requires:

- Target contract's address,
- Value to be sent (proxy fowarder only)
- Desired calldata (function name and its arguments).

It takes care of the replay protection (multinonce/bitflip) and authorising the meta-transaction under the hood. The returned `params` can be used to send the meta-transaction to Ethereum:

```
const relayer = Wallet.fromMnemonic("");

// All meta-transactions for ProxyAccountFactory are sent from the user's ProxyAccount contract.
// We assume it is already deployed on the network. Look at the ProxyAccountFactory section to
// find out more (super-easy to deploy).
const proxyAccount = new ProxyAccountFactory(relayer).attach(params.to);
const tx = await proxyAccount
        .connect(relayer)
        .forward(
          params.target,
          params.value,
          params.data,
          params.replayProtection,
          params.replayProtectionAuthority,
          params.signature
        );

```

### All done! Good work!

Here is a full example:

```
// What contract and function do we want to execute? And who is the signer?
const user = Wallet.fromMnemonic("");
const targetContract = new EchoFactory(user).attach("");
const value = new BigNumber("0");
const callData = targetContract.interface.functions.test.encode([]);

// Prepare and authorise the meta-transaction
const forwarder = ForwarderFactory.getProxyForwarder(ChainID.MAINNET, ReplayProtectionType.MULTINONCE, signer);
const params = await forwarder.signMetaTransaction({ target: targetContract.address, value, callData }) ;

// Relayer publishes transaction
const relayerWallet Wallet.fromMnemonic("");
const encodedMetaTx = forwarder.encodeMetaTransaction(params);
const tx = await relayerWallet.sendTransaction( {to: params.to, data: encodedMetaTx}) );
const receipt = await tx.wait(1)
```

As we can see in the above, it is easy for the user to craft and sign a meta-transaction for the target contract. The `params` (or its encoding) can be wrapped in an Ethereum transaction and sent to the blockchain.

## ProxyAccountsDeployer vs RelayHub

As we mentioned earlier, there are two solutions to the msg.sender problem.

- **ProxyAccountDeployer**: Deploys a proxy account contract for the user with a deterministic address. All meta-transactions are sent via the user's proxy account.
- **RelayHub**: There is no proxy account contracts. The RelayHub appends the signer's address onto the calldata that is sent to the target contract. It requires the target contract to support the \_msgSender() standard.

While the ProxyAccountDeployer works for all existing smart contracts, the RelayHub requires the target contract to support the \_msgSender() standard. If supported, the RelayHub allows the signer's address to be the msg.sender in the target contract. Going forward, we hope that the RelayHub serves as a model and it can later become a precompile/a new opcode in Ethereum.

Note, the one big difference between the ProxyAccountDeployer and the RelayHub is the forward() function. ProxyAccountDeployer lets the user set `value` of ETH that can be sent (e.g. the proxy account can have an ETH balance) in the meta-transaction. However, the RelayHub does not have a `value` argument and does not support sending ETH. See [this issue](https://github.com/anydotcrypto/metatransactions/issues/9) to find out why.

### Proxy Hub

It is a central registry contract that is responsible for deploying proxy contracts (`ProxyAccount.sol`). Every proxy contract is destinated for a single user and it has a deterministic address via CREATE2. We use the [CloneFactory](https://github.com/optionality/clone-factory/blob/master/contracts/CloneFactory.sol) to minimise storage overhead on the network.

There is only one function to care about:

```
const user = Wallet.fromMnemonic("");
await proxyHub.createProxyContract(user.address);
```

It deploys a new `ProxyAccount` for the user and then stores a record of it in the ProxyAccountDeployer. Our ProxyAccount is a minimal contract that checks the user's signed the meta-transaction and the replay protection is valid. It only has two functions:

- **DeployContract contracts**: Deploys a new smart contract with a deterministic address.

```
await proxyAccount.deployContract(
          initData: string, // Bytecode of the contract
          replayProtection: string, // Encoding of replay protection (nonce1, nonce2)
          replayProtectionAuthority: string, // Address (default is 0x00....)
          signature: string // Signer's signature (address stored in proxy)
        );

```

- **Forward**: Calls out to the target contract with the user's desired calldata.

```
await proxyAccount.forward(
        target: string, // Contract address
        value: BigNumber, // ETH to send
        data: string, // Calldata
        replayProtection: string, // Encoding of replay protection (nonce1, nonce2)
        replayProtectionAuthority: string, // Address (default is 0x00....)
        signature: string // Signer's signature (address stored in proxy)
);
```

Let's look at a full code example.

```
// Who is our signer?
const user = Wallet.fromMnemonic("");
const relayer = Wallet.fromMnemonic("");


// Deploying a smart contract
const echoFactory = new EchoFactory(user);
const initCode = echoFactory.getDeployTransaction().data! as string; // Constructor arguments accepted

// Set up meta-transaction handler and sign meta-deployment
const forwarder = ForwarderFactory.multinonce(ChainID.MAINNET, ContractType.PROXYACCOUNTDEPLOYER, 100);
const params = await forwarder.signMetaDeployment(user, initCode);

// Send to the network via the ProxyAccount sends transaction to network (or sent up to Relayer API)
// Fetch the proxy account
const encodedMetaDeployment = forwarder.encodeMetaDeployment(params);
const tx = await relayer.sendTransaction({to: params.to, data: encodedMetaDeployment});

// Compute deterministic address for the deployed contract (helper function coming soon)
const hByteCode = arrayify(keccak256(initCode));
const encodeToSalt = defaultAbiCoder.encode(["address", "bytes"],[signer.address, params.replayProtection]);
const salt = arrayify(keccak256(encodeToSalt));
const echoAddress = await proxyAccount.connect(relayer).computeAddress(salt, hByteCode);

// Fetch the echo contract
const echoContract = echoFactory.attach(echoAddress);

// Sending the meta-transaction
const callData = echoContract.interface.functions.broadcastMessage.encode([]);
const value = new BigNumber("0");
const params = await forwarder.signMetaTransaction(
        {to: echoContract.address,
        value,
        callData}
      );

// Send to Ethereum (or send up to the RelayerAPI)
const tx = proxyAccount.connect(relayer).forward(
        params.target,
        params.value,
        params.data,
        params.replayProtection,
        params.replayProtectionAuthority,
        params.signature
);
```

### Relay Hub

It is a central registry contract that keeps track of the signer's address and the state of their replay protection. It can only be used with smart contracts that support the \_msgSender() standard and inherit [MsgSender](https://github.com/anydotcrypto/metatransactions/blob/master/src/contracts/account/MsgSender.sol). The global singleton [RelayHub](https://etherscan.io/address/0x70107abb312db18bd9addec39ce711374b09ebc1) must be hard-coded into the target contract. We hope it will become a standard that has community support & it can be included in all new contracts.

The benefit of the RelayHub is that the signer's address is set as the msg.sender and there are no proxy contracts. Thus, it is more natural for the user who wants to look up their address in the contract. We hope our RelayHub will eventually become a new precompile or opcode in Ethereum - which may ultimately solve the msg.sender problem for relay transactions.

It only has two functions:

- **DeployContract contracts**: Deploys a new smart contract with a deterministic address.

```
await relayHub.deployContract(
          initData: string, // Bytecode of the contract
          replayProtection: string, // Encoding of replay protection (nonce1, nonce2)
          replayProtectionAuthority: string, // Address (default is 0x00....)
          signature: string // Signer's signature (address stored in proxy)
        );
```

- **Forward**: Calls out to the target contract with the user's desired calldata. The signer's address is appended to the calldata sent to the target contract.

```
await relayHub.forward(
        target: string, // Contract address
        data: string, // Calldata
        replayProtection: string, // Encoding of replay protection (nonce1, nonce2)
        replayProtectionAuthority: string, // Address (default is 0x00....)
        signature: string // Signer's signature (address stored in proxy)
);
```

Here is a code example for both:

```
// Who is our signer?
const user = Wallet.fromMnemonic("");
const relayer = Wallet.fromMnemonic("");

// Deploying a smart contract
const echoFactory = new EchoFactory(user);
const initCode = echoFactory.getDeployTransaction().data! as string; // Constructor arguments accepted

// Set up meta-transaction handler and sign meta-deployment
const forwarder = ForwarderFactory.multinonce(ChainID.MAINNET, ContractType.RELAYHUB, 100);
const params = await forwarder.signMetaDeployment(user, initCode);

// Relayer sends transaction to network
const relayHubAddress = ForwarderFactory.getHubAddress(ChainID.MAINNET, ContractType.RELAYHUB);
const relayHub = new RelayHubFacotry(relayer).attach(relayHubAddress);
const tx = await relayHub.connect(relayer).deployContract(
          params.data,
          params.replayProtection,
          params.replayProtectionAuthority,
          params.signature
        );

// Compute deterministic address for the deployed contract (helper function coming soon)
const hByteCode = arrayify(keccak256(initCode));
const encodeToSalt = defaultAbiCoder.encode(["address", "bytes"],[signer.address, params.replayProtection]);
const salt = arrayify(keccak256(encodeToSalt));
const echoAddress = await relayHub.connect(relayer).computeAddress(salt, hByteCode);

// Fetch the echo contract
const echoContract = echoFactory.attach(echoAddress);

// Sending the meta-transaction
const callData = echoContract.interface.functions.broadcastMessage.encode([]);
const value = new BigNumber("0");
const params = await forwarder.signMetaTransaction(
        user,
        echoContract.address,
        value,
        callData
      );

// Send to Ethereum (or send up to the RelayerAPI)
const tx = relayHub.connect(relayer).forward(
        params.target,
        params.data,
        params.replayProtection,
        params.replayProtectionAuthority,
        params.signature
);
```

## How to build and test the library locally

We need to install the NPM packages:

```
npm i
```

Then we can simply build and test:

```
npm run build && npm run test
```

## Where is the ProxyAccountFactory and RelayHub?

We have deployed the latest version of the ProxyAccountFactory and RelayHub. The links can be found below.

Mainnet:

- [ProxyAccountFactory](https://etherscan.io/address/0xE139c086d9EEC16cBaF5a125FFf748939Fb734f1)
- [RelayHub](https://etherscan.io/address/0x36892A63E99d66d01766e227F3cCc6235dE09eD9)

Ropsten:

- [ProxyAccountFactory](https://ropsten.etherscan.io/address/0x5A60af44A45d11Cefd0182cb0514cce3149a0445)
- [RelayHub](https://ropsten.etherscan.io/address/0xf4cb3Ff902f8fE23f3638Eb6F33B467c4180e605)

Thanks for checking out this code repository. It was first motivated by EIP-2585 and the RelayHub standard by the GSN.
