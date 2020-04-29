# A Minimal Meta-Transaction Library

Ethereum transaction's intertwine the identity of who paid for the transaction (gas.payer) and who wants to execute a command (msg.sender). As a result, it is **not straight forward for Alice to pay the gas fee on behalf of Bob** who wants to execute a command in a smart contract. Until it is fixed at the platform level, then Alice and Bob must adopt a meta-transaction standard in order to support this functionality (e.g. transaction infrastructure as a service in a non-custodial manner). 

There are two approaches: 

- **Proxy contracts:** All transactions for the user are sent via a proxy contract and it is compatible with all existing smart contracts. 
- **\_msgSender():** All transactions are sent via a global RelayHub.sol contract and the target contract must support the standard which requires it to replace msg.sender with \_msgSender(). It is only compatible with contracts that have upgraded to use the standard. 

We have put together this meta-transaction library to support both approaches and there are several benefits:
- **Ease of adoption:** New smart contracts do not need to handle replay protection (e.g. the permit() standard). 
- **Global RelayHub:** The \_msgSender() standard requires a hard-coded relayhub contract. This is a minimal RelayHub.sol that simply deals with checking replay protection before calling the target contract. 
- **Single standard & library:** There are several ways to construct and sign meta-transactions, so we hope this repository can become a single standard that any project can adopt. 

The end-goal of this library is to make it easier for developers and users to tap into third party APIs that focus on getting transactions in the blockchain. 

## Getting started 

We assume you have already set up your environment and you simply need to plug-in our library. 

1. You need to install the NPM pacakge: 

```
npm i @anydotcrypto/metatransactions --save-dev
```

2. You need to import the package into your file: 

```
import {ChainID, ContractType,  MetaTxHandler } from "@anydotcrypto/metatransactions/dist";
```

3. You need to decide which msg.sender solution to use and for what network. 

We have created two enumerations to keep it simple:

```
ChainID.MAINNET
ChainID.ROPSTEN

ContractType.PROXYHUB
ContractType.RELAYHUB
```

We cover the pros (and cons) for the contract types here. If you are unsure which one to use, then we recommend ```ContractType.ProxyHub``` as it works for all existing contracts. e.g. the meta-transaction is sent via a minimal proxy contract and the msg.sender will be the proxy contract's address. 

4. You need to decide which replay protection to use.

Our library contains three types of replay protectio (and more in-depth information can be [found here](https://github.com/PISAresearch/metamask-comp)):
- **Replace-by-nonce**: Same as Ethereum, it increments a nonce for every new transaction.
- **Multinonce:** There are multiple replace-by-nonce queues, so it supports up to N concurrent transactions at any time.
- **Bitflip:** There is no queue and all transactions are processed out of order (e.g. batch withdrawals).

If you want to use Replace-by-nonce && Multinonce: 

``` 
const concurrency = 10;
const metaTxHandler = MetaTxHandler.multinonce(ChainID.MAINNET, ChainID.PROXYHUB, concurrency); 
```

This sets up the meta-transaction handler to use the multinonce replay proetction with 10 nonce queues and to authorise all meta-transactions to be sent via a proxy contract. If you want all transactions to be processed in the transaction by order, then just set ```concurrency=1```. 

If you want to use bitflip: 

```
const metaTxHandler = MetaTxHandler.bitflip(ChainID.MAINNET, ChainID.PROXYHUB);
```

This sets up the meta-transaction handler to use the bitflip replay protection and to authorise all meta-transactions to be sent via a proxy contract. Bitflip is that supports an _unlimited number of concurrent transactions_ which is useful for batch withdrawals. It does not support ordered transactions, so use replace-by-nonce if you require ordering. 

5. Using the meta-transaction handler to authorise a transaction. 

```
const user = Wallet.fromMnemonic(""); 
const callData = echo.interface.functions.broadcastMessage.encode(["to the moon"]);
const value = new BigNumber("0");

const metaTxHandler = MetaTxHandler.multinonce(ChainID.MAINNET, ContractType.PROXYHUB, 100);
const params = await metaTxHandler.signMetaTransaction(user, echo.address, value, callData) ;
```

The meta-transaction handler just requires the users signing wallet, the target contract's address, the value to be sent (proxy contracts only) and the desired calldata (function name and its arguments). It takes care of the replay protection and authorising the meta-transaction under the hood. The returned ```params``` can be used to finally send the meta-transaction to Ethereum: 

```
const relayer = Wallet.fromMnemonic("");

// All meta-transactions for ChainID. ProxyHub are sent from the user's ProxyAccount contract.
// We assume it is already deployed on the network. Look at the ProxyHub section to 
// find out more (super-easy to deploy). 
const proxyAccount = new ProxyAccountFactory(relayer).attach(params.hub);
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
We have included an additional ```relayer``` class that is an example on how a relayer can take the forward parameters and send it to the network. It also includes functionality for encoding the meta-transaction and sending it in the ```data``` field of a transaction. 

### All done! Good work! 

Here is a full example: 
```
// What contract and function do we want to execute? And who is the signer?  
const user = Wallet.fromMnemonic(""); 
const targetContract = new EchoFactory(user).attach("");
const value = new BigNumber("0"); 
const callData = targetContract.interface.functions.test.encode([]);

// Prepare and authorise the meta-transaction
const metaTxHandler = MetaTxHandler.multinonce(ChainID.MAINNET, ContractType.PROXYHUB, 100);
const params = await metaTxHandler.signMetaTransaction(user, targetContract.address, value, callData) ;

// Set up a relayer to publish the metatx 
const relayerWallet Wallet.fromMnemonic(""); 
const relayerAPI = new RelayerAPI(proxyHub);
const tx = await relayerAPI.forward(relayerWallet, params); // Assumes ProxyAccount exists. 
const receipt = await tx.wait(1)
```

As we can see in the above, it is easy for the user to craft and sign a meta-transaction for the target contract. The parametesr (or its encoding) can be sent to the RelayerAPI who takes care of wrapping it in an Ethereum transaction and getting it in the blockchain. 

## ProxyHub vs RelayHub

As we mentioned earlier, there are two solutions to the msg.sender problem. 

- ProxyHub: Deploys a proxy account contract for the user with a deterministic address. All meta-transactions are sent via the user's proxy account. 
- RelayHub: There is no proxy account contracts. The RelayHub appends the signer's address onto the calldata that is sent to the target contract. It requires the target contract to support the \_msgSender() standard. 

While the ProxyHub works for all existing smart contracts, the RelayHub allows the signer's address to be the msg.sender in the target contract. Going forward, we hope that the RelayHub serves as an example that can become a precompile/a new opcode in Ethereum. 

Note, the one big difference between the ProxyHub and the RelayHub is the forward() function. ProxyHub lets the user set a ```value``` of ETH that can be sent (e.g. the proxy account can have an ETH balance). However, the RelayHub does not have a ```value``` argument and does not support sending ETH. See [this issue](https://github.com/anydotcrypto/metatransactions/issues/9) to find out why. 

### Proxy Hub

It is a central registry contract that is responsible for deploying proxy contracts (```ProxyAccount.sol```). Every proxy contract is destinated for a single user and it has a deterministic address via CREATE2. We have used the [CloneFactory](https://github.com/optionality/clone-factory/blob/master/contracts/CloneFactory.sol) to minimise storage overhead on the network.

There is only one function that we care about:

```
const user = Wallet.fromMnemonic("");
await proxyHub.createProxyContract(user.address); 
```

It deploys a new ```ProxyAccount``` for the user and then stores a record of it in the ProxyHub. Our ProxyAccount is a minimal contract that checks the user's signed the meta-transaction and the replay protection is valid. It only has two functions: 

- **Forward**: Calls out to the target contract with the user's desired calldata.  
- **DeployContract contracts**: Deploys a new smart contract with a deterministic address. 

Here is a code example for both: 
```
// Who is our signer?
const user = Wallet.fromMnemonic("");
const relayer = Wallet.fromMnemonic("");

// Fetch the proxy account 
const proxyAccountAddress = await ProxyHub.accounts(user.address); // It is also easy to compute it. 
const proxyAccount = new ProxyAccountFactory(user).attach(proxyAccountAddress);

// Deploying a smart contract
const echoFactory = new EchoFactory(user);
const initCode = echoFactory.getDeployTransaction().data! as string; // Constructor arguments accepted

// Set up meta-transaction handler and sign meta-deployment
const metaTxHandler = MetaTxHandler.multinonce(ChainID.MAINNET, ContractType.PROXYHUB, 100);
const params = await metaTxHandler.signMetaDeployment(user, initCode);

// Relayer sends transaction to network (or sent up to Relayer API)
const tx = await proxyAccount.connect(relayer).deployContract(
          params.data,
          params.replayProtection,
          params.replayProtectionAuthority,
          params.signature
        );
        
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
const params = await metaTxHandler.signMetaTransaction(
        user,
        echoContract.address,
        value,
        callData
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
- **Forward**: Calls out to the target contract with the user's desired calldata. The signer's address is appended to the calldata sent to the target contract. 
- **DeployContract contracts**: Deploys a new smart contract with a deterministic address. 

Here is a code example for both:

```
// Who is our signer?
const user = Wallet.fromMnemonic("");
const relayer = Wallet.fromMnemonic("");

// Deploying a smart contract
const echoFactory = new EchoFactory(user);
const initCode = echoFactory.getDeployTransaction().data! as string; // Constructor arguments accepted

// Set up meta-transaction handler and sign meta-deployment
const metaTxHandler = MetaTxHandler.multinonce(ChainID.MAINNET, ContractType.RELAYHUB, 100);
const params = await metaTxHandler.signMetaDeployment(user, initCode);

// Relayer sends transaction to network (or sent up to Relayer API)
const relayHubAddress = MetaTxHandler.getHubAddress(ChainID.MAINNET, ContractType.RELAYHUB);
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
const params = await metaTxHandler.signMetaTransaction(
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

Thanks for checking out this code repository. It was first motivated by EIP-2585 and the RelayHub standard by the GSN. 
