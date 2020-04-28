# A Minimal Meta-Transaction Library

Ethereum transaction's intertwine the identity of who paid for the transaction (gas.payer) and who wants to execute a command (msg.sender). As a result, it is not straight forward for Alice to pay the gas fee on behalf of Bob who wants to execute a command in a smart contract. Until it is fixed at the platform level, then Alice and Bob must adopt a meta-transaction standard in order to support this functionality (e.g. transaction infrastructure as a service in a non-custodial manner). 

There are two approaches: 

- **Proxy contracts** All transactions for the user are sent via a proxy contract and it is compatible with all existing smart contracts. 
- **\_msgSender()** All transactions are sent via a global RelayHub.sol contract and the target contract must support the standard which requires it to replace msg.sender with \_msgSender(). It is only compatible with contracts that have upgraded to use the standard. 

We have put together this meta-transaction library to support both approaches and there are several benefits:
- **Ease of adoption.** New smart contracts do not need to handle replay protection (e.g. the permit() standard). 
- **Global RelayHub.** The \_msgSender() standard requires a hard-coded relayhub contract. This is a minimal RelayHub.sol that simply deals with checking replay protection before calling the target contract. 
- **Single standard & library.** There are several ways to construct and sign meta-transactions, so we hope this repository can become a single standard that any project can adopt. 

The end-goal of this library is to make it easier for developers and users to tap into third party APIs that focus on getting transactions in the blockchain. 

## Getting started 

We assume you have already set up your environment and you simply need to plug-in our library. 

1. You need to install the NPM pacakge: 

```
npm i @anydotcrypto/metatransactions --save-dev
```

2. You need to import the package into your file: 

```
import { MetaTxHandler } from "@anydotcrypto/metatransactions/dist";
```

3. You need to decide which msg.sender solution to use and we have four options:

```
ropsten-proxyhub
mainnet-proxyhub
ropsten-relayhub
mainnet-relayhub
```

We cover the pros/cons for the ProxyHub and RelayHub here. If you are not sure which one to use, then we recommend ```mainnet-proxyhub``` as it works for all existing contracts. e.g. every relay transactions are sent via a minimal proxy contract. 

4. You need to decide which replay protection to use and we have two options.

The first option is to use multinonce: 

``` 
const userWallet: Wallet = ....; 
const networkHub = "mainnet-proxyhub";
const concurrency = 10;
const metaTxHandler = MetaTxHandler.multinoncePreset(userWallet, networkHub, concurrency); 
```

This sets up the meta-transaction handler to use multinonce replay protection with a default number of queues as 10. The benefit of multinonce is that it will let you perform up to ```concurrency``` out-of-order transactions at any one time. Essentially, there are ten nonce queues and it will rotate queues for every new transaction. If you want all transactions to always be processed by the blockchain in order, then just set ```concurrency=1```.


The second option is to use bitflip:

```
const userWallet: Wallet = ....;
const networkHub = "mainnet-proxyhub";
MetaTxHandler.bitflipPreset(userWallet, networkHub);
```

This sets up the meta-transaction handler to use the bitflip replay protection. The benefit of bitflip is that supports an _unlimited number of concurrent transactions_ which is useful for batch withdrawals. It does not support ordered transactions, so if you need that functionality then use multinonce. 

5. Authorising a meta-transaction 

```
const targetContract = .....;
const userWallet = ....;
const value = new BigNumber("0"); // Ignored if the RelayHub is used. 
const callData = targetContract.interface.functions.test.encode([]);

// Sign the meta transaction - handles replay protection under the hood.
const params = await metaTxHandler.signMetaTransaction(
        userWallet,
        targetContract.address,
        value,
        callData
      );

// Broadcast metatransaction 
const relayerWallet ....; // 
const tx = metaTxHandler.forward(relayerWallet, params); // Packs metatx into an Ethereum transaction and broadcasts it
const txReceipt = await tx.wait(1); // Wait for 1 block confirmation 
```

As we can see in the above, we simply need to get the calldata for the target contract (e.g. the function name and its arguments). We can then use the ```MetaTxHandler``` to return a signed meta-transaction and the library will take care of all replay protection under the hood. You can simply wrap it in an Ethereum transaction and broadcast it to the network, or send it to your relayer's API.  

All done! Good work! 

## ProxyHub vs RelayHub

TODO: Talk about the pros and cons of each approach. 

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
