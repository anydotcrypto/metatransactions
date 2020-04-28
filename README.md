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

## Replay Protection Hub

We have created a single class, RelayProtectionHub, that takes care of signing meta-transactions for the RelayHub / Contract Account.

It supports by default:

- Replace by nonce (single queue)
- Multinonce (multiple queues)
- Bitflip

### How to set up

We will cover how to set up the RelayHub as setting up a ContractHub is very similar.

To create your own relay hub:

```
  const relayHubFactory = new RelayHubFactory(admin);
  const relayHubCreationTx = relayHubFactory.getDeployTransaction();
  const relayHubCreation = await admin.sendTransaction(relayHubCreationTx);
  const receipt = await relayHubCreation.wait(1);
```

To connect to an existing relay hub:

```
  const relayHubAddress = "0x0......";
  const relayHubFactory = new RelayHubFactory(admin);
  const relayHub = relayHubFactory.attach(relayHubAddress);
```

To set up the replay protection hub:

```
// Single queue
const ReplayProtection = ReplayProtection.multinonce(relayHub, 1);

// Multi queue
const ReplayProtection = ReplayProtection.multinonce(relayHub, 10);

// Bitflip
const ReplayProtection = ReplayProtection.bitFlip(relayHub);

```

In the future, the RelayHub for Ropsten and Mainnet will be hard-coded into this library. As a developer, you will simply need to pick the appropriate replay protection.

### How to sign a meta-transaction

A meta-transaction has the following parameters:

- Signer: The Wallet of the signer
- Target address: The address of the target contract
- Value: Quantity of ether to transfer (only useful for contract accounts)
- Calldata: Encoded function to call and the appropriate data

To sign a meta-transaction:

```
const callData = targetContract.interface.functions.test.encode([]);

const params = await ReplayProtection.signMetaTransaction(
  signer,
  targetContract.address,
  new BigNumber("0"),
  callData
);
```

A list of parameters is returned which can be used to send the transaction:

```
interface ForwardParams {
  hub: string; // Relay hub (or contract account) address
  signer: string; // Signer's address
  target: string; // Target contract address
  value: string; // Value to send
  data: string; // Calldata for target
  replayProtection: string; // Encoded replay protection
  replayProtectionAuthority: string; // Address of replay protection authority
  chainId: number; // ChainID
  signature: string; // Signer's signature
}
```

To send off the meta-transaction, the relayer just needs to execute forward:

```
const tx = relayHub.connect(sender).forward(params.target, params.value, params.data, params.replayProtection, params.replayProtectionAuthority, params.signer, params.signature);
```

While the application is alive, the last replay protection used for the signer will be remembered. If the application restarts, it will fetch the last used values from the hub contract.

Of course, be careful that there is a race condition if there is a restart while some meta-transactions are still in-flight. A future release may inspect the pending pool for the relevant data, but for 99% of cases it is not necessary.

## How to build and test

We need to install the NPM packages:

```
npm i
```

Then we can simply build and test:

```
npm run build && npm run test
```
