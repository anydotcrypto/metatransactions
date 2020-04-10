# A Minimal Relay Hub (motivated by EIP-2585).
 
The fundamental problem that we are trying to solve is that an Ethereum transaction intertwines the identiies of who paid for the transaction (gas.payer) and who wants to execute a command (msg.sender). As a result, it is not straight forward for Alice to pay the gas fee on behalf of Bob who wants to execute a command in a smart contract. 

There are plenty of reasons why Alice might want to pay for the gas. 
- Better user-experience for new customers
- Offer transaction infrastructure as a service in a non-custodial manner

There are two ways to help solve the problem:
- Contract accounts: Each user has a smart contract that forwards commands
- _msgSender: Modify existing smart contracts to support accepting externally signed messages.

The problem, like all problems in Ethereums, is that there are several standard ways to implement it (roll-your-own proxy or roll-your-own permit). More often than not, existing solutions intertwine with the application and it is hard to generalise it. 

If we boil down the problem - what really needs to be solved is just replay protection for the meta-transaction. e.g. is this the latest signed message by the user? and of course, has this signed message been seen before? 

Our goal is to build a minimal forwarder that simply deals with replay protection before forwarding on the call. By solving this basic problem:

- Dual-support: We can support both contract accounts and _msgSender(), 
- Single client library: We can work together on a single client library for authorising meta-transactions
- Better-than-Ethereum Replay Protection: We can experiment with more exciting replay protection to support concurrent transactions

In the end, we hope that all projects that rely on meta-transactions can use one of the hubs as a middleman. 

```e.g. Relay.sol -> Hub.sol -> Target.sol.```

## Default replay protection mechanisms (INCOMPLETE)

We have two in-built replay protection mechanisms outlined [in detail here](https://github.com/PISAresearch/metamask-comp).

In both cases, there is a single mapping:

```
    mapping(bytes32 => uint256) public nonceStore;
```


### Replace-by-nonce 

```nonce(signer, nonce1, nonce2)```


```bitflip(signer, nonce1, bitToFlip)```


 
## How to build and test
 
We need to install the NPM packages:

```
npm i
```

Then we can simply build and test:

```
npm run build && npm run test
```


