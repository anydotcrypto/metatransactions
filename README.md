# A Minimal Relay Hub (motivated by EIP-2585).
 
The fundamental problem we are solving is that an Ethereum transaction intertwines the identity of who paid for the transaction (gas.payer) and who wants to execute a command (msg.sender). As a result, it is not straight forward for Alice to pay the gas fee on bealf of Bob who wants to execute a command in a smart contract.  

Generally, the motivating reason to solve this problem is to allow a third party (Alice) to offer transaction infrastructure as a service to others (bob) in a non-custodial manner. This is useful for wallet providers who can offer a better user-experience for customers while maintaining their self-custody and for most new projects who can plug-in an infura-like transaction API instead of re-building the infrastructure themselves. 

So far, there are two prominent methods to solve the problem: 
- Contract accounts: Each user has a smart contract that forwards commands
- \_msgSender: Modify existing smart contracts to support accepting externally signed messages.

The problem, like all problems in Ethereum, is that there are several standard ways to implement it (roll-your-own proxy or roll-your-own permit). More often than not, existing solutions intertwine with the application and it is hard to generalise it. 

But if we boil down the problem, what really needs to be solved is just replay protection for the meta-transaction. e.g. Is this the latest signed message by the user? And of course, has this signed message been seen before? 

Our goal is to provide a minimal forwarder that simply handles replay protection for the signer before forwarding the contract call: 

- Dual-solution: Support both contract accounts and \_msgSender()
- Client library: Provide a single client library for authorising a meta-transaction 
- Better-than-Ethereum Replay Protection: Experiment with more exciting repay protection to support concurrent and out-of-order transactions. 

Of course, this solution cannot help existing users who sign Ethereum transactions to authenticate via msg.sender for existing contracts. Going forward, it can help users who are willing to switch their identity to a contract account (msg.sender) or if contracts adopt the \_msgSender() standard. 

## High-level overview of architecture [TO COMPLETE]

## Forwarding calls 

We have a single forward function in the relay and contract hub:

```    
function forward(
   address _target,
   uint _value, // only used for accounts
   bytes memory _callData,
   bytes memory _replayProtection,
   address _replayProtectionAuthority,
   bytes memory _signature) public {

   // Assumes that ContractHub is ReplayProtection. 
   bytes memory encodedCallData = abi.encode(_target, _value, _callData);

   // Reverts if fails.
   address signer = verify(encodedCallData, _replayProtection, _replayProtectionAuthority, _signature);

   // Check if the user wants to send command from their contract account or signer address
   (bool success,) = _target.call(abi.encodePacked(_callData, signer));
   require(success, "Forwarding call failed.");
}
```

The data can be split into three catorgies:

- Target contract: User wants to invoke the calldata for the target address, and possibly send V coins. 
- Replay protection: Encoded replay protection and an address of a replay protection authority. 
- Authentication and signature: Signature that covers the target contract, replay protectiom, chainID and the hub's address. 

### Target contract

Preparing the data for the target contract is straight forward. In etherjs, once we have the Contract, it is simply:

```      
const msgSenderFactory = new MsgSenderExampleFactory(admin); // Fetch the factory 
const msgSenderCon = await msgSenderFactory.deploy(result.contractAddress!); // Deploy or attach the contract 
const msgSenderCall = msgSenderCon.interface.functions.test.encode([]); // Fetch the function name via the interface. Arguments are provided in the []. 

// Encode the calldata for the forwarder 
const encodedCallData = defaultAbiCoder.encode(["address", "uint", "bytes"],[msgSenderCon.address, value, msgSenderCall]
      );
```
Of course, encodedCallData is included in user's signature. 


### Replay protection 

We have three built-in replay protections: 

- Replace-by-nonce: Nonce must strictly increment by one (similar to Ethereum)
- Multi-nonce: The first nonce (nonce1) defines the queue and second nonce (nonce2) defines the position in the queue. 
- Bitflip: Given a bitmap, simply flip a bit and send it in. 

More in-depth information can be found about the [replay protection here](https://github.com/PISAresearch/metamask-comp). 

The benefit of multinonce and bitflip is that we can supprot concurrent & out of order transactions. As well, multi-nonce can be re-purposed to provide replace-by-nonce by simply keeping nonce1 == 0.

In the code:
```
function verify(bytes memory _callData,
   bytes memory _replayProtection,
   address _replayProtectionAuthority,
   bytes memory _signature) internal returns(address){

   // Extract signer's address.
   address signer = verifySig(_callData, _replayProtection, _replayProtectionAuthority, getChainID(), _signature);

   // Check the user's replay protection.
   if(_replayProtectionAuthority == address(0x0000000000000000000000000000000000000000)) {
      // Assumes authority returns true or false. It may also revert.
      require(nonce(signer, _replayProtection), "Multinonce replay protection failed");
   } else if (_replayProtectionAuthority == address(0x0000000000000000000000000000000000000001)) {
      require(bitflip(signer, _replayProtection), "Bitflip replay protection failed");
   } else {
      require(IReplayProtectionAuthority(_replayProtectionAuthority).updateFor(signer, _replayProtection), "Replay protection from authority failed");
   }

   return signer;
}
```

As we can see, there is the concept of a Replay Protection Authority. This lets the user decide which replay protection mechanism they want to use. Both replace-by-nonce and multi-nonce can be identified by address(0), whereas bitflip by address(1). Otherwise, the relay hub will rely on an external replay protection authority that adheres to the interface. 

Again, the benefit is that out-of-the-box we can supprot out-of-order transactions and in the future experiment with new replay protection emchanisms as they evolve. 

### Authentication and verifying the signature

The signature verification code: 
```
address signer = verifySig(_callData, _replayProtection, _replayProtectionAuthority, getChainID(), _signature);
```

We mentioned previously how to compute \_callData to verify the signature. To encode the \_replaceProtection for multi-nonce or bitflip:


```
const _replayProtection = defaultAbiCoder.encode(["uint", "uint"], [nonce1, nonce2]);
```
The \_replayProtectionAuthority can be address(0), address(1) or an external contract address. The ChainID for mainnet is 1. 

To compute the signature in etherjs:

``` 
const encodedData = defaultAbiCoder.encode(
   ["bytes", "bytes", "address", "address", "uint"],
   [
      encodedCallData,
      encodedReplayProtection,
      replayProtectionAuthority,
      hubContract,
      0,
   ]);
    
const signature = await signer.signMessage(arrayify(keccak256(encodedData)));

```
 
## How to build and test
 
We need to install the NPM packages:

```
npm i
```

Then we can simply build and test:

```
npm run build && npm run test
```


