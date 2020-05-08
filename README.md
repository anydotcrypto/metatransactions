# A Minimal Meta-Transaction Library

Ethereum transaction's intertwine the identity of who paid for the transaction (gas.payer) and who wants to execute a command (msg.sender). As a result, it is **not straight forward for Alice to pay the gas fee on behalf of Bob** who wants to execute a command in a smart contract. Until it is fixed at the platform level, then Alice and Bob must adopt a meta-transaction standard to support this functionality (e.g. transaction infrastructure as a service in a non-custodial manner).

There are two approaches:

- **Proxy contract:** Every user has a proxy contract and all transactions are sent via the proxy contract. It is compatible with all existing smart contracts.  
- **\_msgSender():** All transactions are sent via a single RelayHub  contract and the target contract must support the \_msgSender() standard. It preserves the user's signing key address as their identity.

This meta-transaction library supports both approaches. We hope it benefits the community in the following way: 

- **Ease of adoption:** All smart contracts can support meta-transactions without explicitly handling replay protection (e.g. [implementing a permit() standard](https://github.com/makerdao/dss/blob/master/src/dai.sol#L117-L141)).
- **A candidate RelayHub standard:** Our minimal RelayHub.sol can be a candidate for the hard-coded RelayHub in the \_msgSender() standard.
- **Minimal proxy contracts:** Our ProxyAccount contracts have minimal functionality (e.g. it can only .call() to a target contract) which makes them easy to audit, reason about and adopt.
- **Better-than-Ethereum Replay Protection:** We have implemented Nonce, MultiNonce and BitFlip, so the developer can decide if they want to ordered transactions, multiple queues of transactions, or always out-of-order transactions. 

There are several libraries for constructing and signing meta-transactions, but more often than not it is mixed up with the application logic. This repository is protocol and relayer-independent such that it can become a single standard any project can adopt. Hopefully it will make it easier easier for developers to tap into third party relayer APIs and thus no longer need to re-implement the wheel of building reliable transaction infrastructure. 

# Table of Contents

- [Getting started](#getting-started)
- [You are now ready to authorise a meta-transaction!](#you-are-now-ready-to-authorise-a-meta-transaction-)
  * [Example Echo Contract](#example-echo-contract)
  * [Proxy Account Contract](#proxy-account-contract)
  * [RelayHub](#relayhub)
- [ProxyAccount vs RelayHub](#proxyaccount-vs-relayhub)
  * [Proxy Account Contract](#proxy-account-contract-1)
    + [Deploying the proxy contract](#deploying-the-proxy-contract)
    + [Sign and encode meta-transactions](#sign-and-encode-meta-transactions)
    + [Sign and encode meta-deployments](#sign-and-encode-meta-deployments)
  * [Relay Hub](#relay-hub)
    + [MsgSender.sol](#msgsendersol)
    + [Sign and encode meta-transactions](#sign-and-encode-meta-transactions-1)
    + [Sign and encode meta-deployments](#sign-and-encode-meta-deployments-1)

# Getting started

We assume you have already set up your environment and you simply need to plug-in our library.

1. You need to install the NPM pacakge:

```
npm i @anydotcrypto/metatransactions --save-dev
```

2. Deciding which network and replay protection to use. 

You will need to import both the ChainID and Replay Protection into your code: 

```
import { ChainID, ReplayProtectionType } from "@anydotcrypto/metatransactions";
```
Our library currently supports MAINNET or ROPSTEN. 
```
// Blockchain ID (Mainnet = 3)
ChainID.MAINNET;
ChainID.ROPSTEN;
```
Our library has three types of replay protection (and more in-depth information can be [found here](https://github.com/PISAresearch/metamask-comp)):

- **Replace-by-nonce**: Same as Ethereum, it increments a nonce for every new transaction.
- **Multinonce:** There are multiple replace-by-nonce queues, so it supports up to N concurrent transactions at any time.
- **Bitflip:** There is no queue and all transactions are processed out of order (e.g. batch withdrawals).

To access the replay protection:
```
// ReplayProtection 
ReplayProtectionType.NONCE // Single queue
ReplayProtectionType.MULTINONCE // N queues (default == 30 queues)
ReplayProtectionType.BITFLIP // Always out-of-order & concurrent
```
Both MultiNonce and Bitflip support concurrent & out-of-order transactions by default. If you want to guarantee that all transactions are processed in order, then just set `ReplayProtectionType.NONCE`.

3. You need to decide which solution to msg.sender you want to use. 

For the msg.sender solution, we cover [Proxy Account Contracts vs the RelayHub](https://github.com/anydotcrypto/metatransactions#proxyaccount-vs-relayhub) later in the README. If you are unsure which one to use, then ***we recommend proxy account contracts as it works for all existing contracts***. 

4. Time to instantiate the meta-transaction library with your prefered options! 

To instantiate the proxy account forwarder: 
```
const signer = Wallet.Mnemonic("");
const forwarder = new ProxyAccountForwarderFactory().createNew(
    ChainID.ROPSTEN,
    ReplayProtectionType.MULTINONCE,
    signer
 );
```

The forwarder links the signer's wallet to their proxy account contract. 

Important: It will sign meta-transactions even if the proxy account contract does not exist on the blockchain (e.g. it is not yet deployed). As we will see, it is easy to send up a batch transaction to the relayer such that a single Ethereum transaction will meta-deploy the proxy account contract before executing the meta-transaction. So there is no waiting/setup process. 

To instantiate the RelayHub forwarder: 
```
const signer = Wallet.Mnemonic("");
const relayHubForwarder = new RelayHubForwarderFactory().createNew(
    ChainID.ROPSTEN,
    ReplayProtectionType.NONCE,
    signer
);
```
There is a single instance of the RelayHub on each network and the forwarder links to it. All replay protection is handled by the RelayHub contract and there is no requirement to broadcast/setup in advance. Again, it only works if the target contract supports the  \_msgSender() standard.

# You are now ready to authorise a meta-transaction!

We will show how to authorise a meta-transaction using a proxy account contract or the relay hub.

## Example Echo Contract

We will use the Echo smart contract for both examples: 

```
pragma solidity ^0.6.2;
contract Echo {
    event Broadcast(address signer, string message);
    function submit(string memory _message) public
    {
        emit Broadcast(msg.sender, _message);
    }
}
```

## Proxy Account Contract

Let's set up our forwarder and signer:

```
const user = Wallet.Mnemonic("");
const relayer = Wallet.Mnemonic(""); 
const forwarder = new ProxyAccountForwarderFactory().createNew(
    ChainID.ROPSTEN,
    ReplayProtectionType.MULTINONCE,
    user
);
```

We can deploy the signer's proxy account contract (note: it is very easy to meta-deploy the proxy account contract alongside the first meta-transaction):

```
const isProxyDeployed = await forwarder.isProxyContractDeployed();
if (!isProxyDeployed) {
    const encodedTx = await forwarder.createProxyContract();
    
    // For our example we mimic the relayer API with a relayer wallet. 
    const proxyTx = await relayer.sendTransaction({
      to: encodedTx.to,
      data: encodedTx.callData,
    });
    
    // Wait 1 block confirmation
    const proxyReceipt = await proxyTx.wait(1);
}
```

To authorise a meta-transaction you must supply:
- **Target** contract's address,
- **Value** to be sent 
- **Calldata** the function name and its arguments

We show how to do that for proxy account contracts: 

```
// Fetch the contract and the calldata. 
const echo = new EchoFactory(user).attach("");
const callData = echo.interface.functions.submit.encode(["hello"]);

// Sign the meta transaction & encode it.
const metaTx = await forwarder.signMetaTransaction({
    target: echo.address,
    value: new BigNumber("0"),
    callData,
});

const encodedMetaTx = await forwarder.encodeSignedMetaTransaction(
    metaTx
);

const submitTicketTx = await relayer.sendTransaction({
    to: metaTx.to,
    data: encodedMetaTx,
});

const submitTicketReceipt = await submitTicketTx.wait(1);
```

Easy right? You have just deployed the proxy account contract and sent a meta-transaction via the proxy account contract. Well done! 

## RelayHub
Let's set up our forwarder and signer: 
```
const user = Wallet.Mnemonic("");
const relayer = Wallet.Mnemonic(""); 

const forwarder = new RelayHubForwarderFactory().createNew(
    ChainID.ROPSTEN,
    ReplayProtectionType.MULTINONCE,
    user
);
```

While there is no setup/deployment to perform for the signer. It is important that your target contract supports the \_msgSender() standard. So let's modify the Echo contract to support the standard:

```
pragma solidity ^0.6.2;
import "https://github.com/anydotcrypto/metatransactions/blob/master/src/contracts/account/MsgSender.sol";

contract Echo is MsgSender {
    event Broadcast(address signer, string message);
    
    // In the future we will hard-code the RelayHub 
    // address into MsgSender.sol
    constructor(address _relayHub) public {
        relayHub = _relayHub;
    }
    function submit(string memory _message) public
    {
        address signer = _msgSender();
        emit Broadcast(signer, _message);
    }
}
```
Now that the target-contract supports the \_msgSender() standard, you must supply the following to authorise a meta-transaction: 
- **Target** contract's address,
- **Calldata** the function name and its arguments

Unlike proxy account contracts, the RelayHub does not yet support native transfers of ETH. Now that we have the necessary informaton let's send the meta-transaction via the RelayHub: 
```
const echo = new EchoFactory(user).attach("");
const callData = echo.interface.functions.submit.encode([message]);

// Sign the meta transaction & encode it.
const metaTx = await forwarder.signMetaTransaction({
    target: cyberDiceCon.address,
    callData,
});
const encodedMetaTx = await forwarder.encodeSignedMetaTransaction(
    metaTx
);

const receipt = await relayer.sendTransaction({
    to: metaTx.to,
    data: encodedMetaTx,
});

const tx = await receipt.wait();
```
Well done!

# ProxyAccount vs RelayHub

As we mentioned earlier, there are two solutions to the msg.sender problem.

- **Proxy Contract Accounts**: Every user has a proxy contract with a deterministic address. All meta-transactions are sent via the user's proxy account. 
- **RelayHub**: There is no proxy account contracts. The RelayHub appends the signer's address onto the calldata that is sent to the target contract. It requires the target contract to support the \_msgSender() standard.

While proxy contract accounts works for all existing smart contracts, the RelayHub requires the target contract to support the \_msgSender() standard. If supported, the RelayHub allows the signer's address to be the msg.sender in the target contract. Going forward, we hope that the RelayHub serves as a model and it can later become a precompile/a new opcode in Ethereum.

Note, the RelayHub does not support holding or sending ETH. It is possible to store a balance for each signer, but we opted for a simple/minimalist RelayHub. Find out more at [this issue](https://github.com/anydotcrypto/metatransactions/issues/9) to find out why.

## Proxy Account Contract

There are two contracts:
- **Proxy Deployer:** Responsible for deploying all proxy account contracts. 
- **Proxy Account:** A proxy contract for a single user.

The motivation for a ProxyDeployer contract is to act as a global registry for all proxy contracts. It is only responsible for deploying proxy contract addresses and thanks to CREATE2 it ensures all signers have a deterministic proxy address. 

The proxy account contract is responsible for acting as the user's identity to other smart contracts such that msg.sender is the proxy contract's address. Our forwarder library ```ProxyAccountForwarder``` has methods to support interacting with proxy contracts. 

### Deploying the proxy contract

We must check if the proxy contract is deployed before deciding to deploy it. 
```
const isDeployed: boolean = await forwarder.isContractDeployed();
const encodedTx: EncodedTx = await forwarder.createProxyContract();
```
The EncodedTx has the following interface:
```
interface EncodedTx {
  to: string; // Target contract address
  data: string; // Calldata for the target contract
  gas: number; // Estimate gas limit (work-in-progress)
}
```
It costs approximately ~110k gas (including transaction overhead) to deploy a proxy contract.

### Sign and encode meta-transactions 

Our library supports signing and encoding the meta-transaction:
```
const callData = echo.interface.functions.submit.encode([message]);

const params: ForwardParams = await forwarder.signMetaTransaction( {to: echo.address, data: callData);
```

The forward parameters has the following interface:
```
interface ForwardParams {
  to: string; // Proxy contract address 
  signer: string; // Signer's address
  target: string; // Target contract address (echo)
  value: string; // Value in WEI to send
  data: string; // Target contract calldata
  replayProtection: string; // Encoded replay protection 
  replayProtectionAuthority: string; // Replay Protection Authority (Advanced feature)
  chainId: number; // Chain ID (MAINNET or ROPSTEN)
  signature: string; // Signer's signature
}
```

As we can see in the forward parameters, the library takes care of fetching the latest replay protection and encoding it for use. If desired, the forward parameters can be used to directly send it to the proxy account:

```
const tx = await proxyAccount.connect(relayer).forward(
    params.target,
    params.value,
    params.data,
    params.replayProtection,
    params.replayProtectionAuthority,
    params.signature
);
```

Of course, it may be simpler to encode and send the meta-transaction:

```
// Encode calldata for ProxyAccount.forward() 
const encodedMetaTx: EncodedTx = await forwarder.encodeSignedMetaTransaction(
    params

// Sent directly to the ProxyAccount with the nencoded calldata
const tx = await relayer.sendTransaction({to: params.to, data: encodedMetaTx});
```

### Sign and encode meta-deployments 

A very exciting feature for our library is to support meta-deployments as the proxy contract will deploy all contracts via CREATE2. Let's dive in:

```
const echoFactory = new EchoFactory(user);
const initCode = competitionFactory.getDeployTransaction().data! as string;

const params: DeploymentParams = await forwarder.signMetaDeployment(
    initCode
);
```

The deployment parameters has the following interface:

```
interface DeploymentParams {
  to: string; // Proxy contract account
  signer: string; // Signer's address
  initCode: string; // Bytecode for the contract 
  replayProtection: string; // Encoded Replay Protection
  replayProtectionAuthority: string; // Replay Protection Authority (advanced feature)
  chainId: number; // ChainID
  signature: string; // Signature
}
```

Again, as we can see, the library handles all replay protection for the user. If desired, the deployment parameters can be used directly to send it to the proxy account:

```
const tx = await proxyAccount.connect(relayer).deployContract(
    params.initCode,
    params.replayProtection,
    params.replayProtectionAuthority,
    params.signature
);
```

Of course, it might just be easier to encode and send the calldata: 

```
  const encodedMetaDeployment = await forwarder.encodeSignedMetaDeployment(
    params
  );
  const tx = await relayer.sendTransaction({
    to: params.to,
    data: encodedMetaDeployment,
  });
```

But what about the new contract address? How do we derive it? 

```
const echoAddress = forwarder.buildDeployedContractAddress(params);
```

Well done! You have leveled up and you can now perform meta-deployments! 

## RelayHub

The RelayHub has a single deployed contract on the network and it is available for all users. 

One way to think about the RelayHub is that it emulates the Ethereum account system. It is only responsible for keeping track of a user's replay protection and verifying their signature. If both conditions pass, then it will append the signer's address to the target contract calldata before forwarding it. 

As we have mentioned several times, the RelayHub is only compatible with contracts that support the \_msgSender() standard. But the advantage of the RelayHub is that the signer's address is the msg.sender and there is no need to deploy a user-specific contract in advance. 

### MsgSender.sol 

The target contract must extend MsgSender.sol and include the contract address of our RelayHub. Let's have a quick look at its code:

```
pragma solidity 0.6.2;
contract MsgSender {
    address public relayHub;
    function _msgSender() internal view virtual returns (address payable) {
        if (msg.sender != relayHub) {
            return msg.sender;
        } else {
            return _getRelayedCallSender();
        }
    }

    function _getRelayedCallSender() private pure returns (address payable result) {
        bytes memory array = msg.data;
        uint256 index = msg.data.length;
        assembly {
            result := and(mload(add(array, index)), 0xffffffffffffffffffffffffffffffffffffffff)
        }
        return result;
    }
}
```

When the RelayHub forwards a call to the target contract it will append the signer's address to the msg.data. So the target contract can simply verify that msg.sender is the RelayHub contract address and then extract the signer's address from the msg.sender. It will return the signer's address to the main contract. 

Thus the target contract must replace msg.sender with \_msgSender():

```
address signer = _msgSender(); 
```

The original idea for msgSender originates from the gas station network (OpenGSN) and we hope to work together with them to standardise the RelayHub.sol. 

### Sign and encode meta-transactions

Our library supports signing and encoding the meta-transaction:
```
const callData = echo.interface.functions.submit.encode([message]);

const params: ForwardParams = await forwarder.signMetaTransaction( {to: echo.address, data: callData);
```

The forward parameters has the following interface:
```
interface ForwardParams {
  to: string; // Proxy contract address 
  signer: string; // Signer's address
  target: string; // Target contract address (echo)
  value: string; // Always set to 0 for the RelayHub
  data: string; // Target contract calldata
  replayProtection: string; // Encoded replay protection 
  replayProtectionAuthority: string; // Replay Protection Authority (Advanced feature)
  chainId: number; // Chain ID (MAINNET or ROPSTEN)
  signature: string; // Signer's signature
}
```

As we can see in the forward parameters, the library takes care of fetching the latest replay protection and encoding it for use. Although it must be mentioned that ```value="0``` as the RelayHub does not support transfering ETH. If desired, the forward parameters can be used to send directly to the relayhub: 

```
const tx = await relayHubContract.connect(relayer).forward( 
    params.target,
    params.data,
    params.replayProtection,
    params.replayProtectionAuthority,
    params.signer,
    params.signature
)
```

Of course, it may be simpler to encode and send the meta-transaction: 

```
// Encode calldata for RelayHub.forward() 
const encodedMetaTx: EncodedTx = await forwarder.encodeSignedMetaTransaction(
    params

// Sent directly to the ProxyAccount with the nencoded calldata
const tx = await relayer.sendTransaction({to: params.to, data: encodedMetaTx});
```


### Sign and encode meta-deployments 

A very exciting feature for our library is to support meta-deployments as the RelayHubt will deploy all contracts via CREATE2. Let's dive in:

```
const echoFactory = new EchoFactory(user);
const initCode = competitionFactory.getDeployTransaction().data! as string;

const params: DeploymentParams = await forwarder.signMetaDeployment(
    initCode
);
```

The deployment parameters has the following interface:

```
interface DeploymentParams {
  to: string; // Proxy contract account
  signer: string; // Signer's address
  initCode: string; // Bytecode for the contract 
  replayProtection: string; // Encoded Replay Protection
  replayProtectionAuthority: string; // Replay Protection Authority (advanced feature)
  chainId: number; // ChainID
  signature: string; // Signature
}
```

Again, as we can see, the library handles all replay protection for the user. If desired, the deployment parameters can be used directly to send it to the RelayHub:

```
const tx = await relayHubContract.connect(relayer).deployContract(
    params.initCode,
    params.replayProtection,
    params.replayProtectionAuthority,
    params.signer,
    params.signature
);
```

Of course, it might just be easier to encode and send the calldata: 

```
  const encodedMetaDeployment = await forwarder.encodeSignedMetaDeployment(
    params
  );
  const tx = await relayer.sendTransaction({
    to: params.to,
    data: encodedMetaDeployment,
  });
```

But what about the new contract address? How do we derive it? 

```
const echoAddress = forwarder.buildDeployedContractAddress(params);
```

^^ and that's all for now folks! 