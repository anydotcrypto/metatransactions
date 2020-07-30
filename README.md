# A Minimal Meta-Transaction Library

Ethereum transaction's intertwine the identity of who paid for the transaction (gas.payer) and who wants to execute a command (msg.sender). As a result, it is **not straight forward for Alice to pay the gas fee on behalf of Bob** who wants to execute a command in a smart contract. Until it is fixed at the platform level, then Alice and Bob must adopt a meta-transaction standard to support this functionality (e.g. transaction infrastructure as a service in a non-custodial manner).

There are two approaches:

- **Proxy contract:** Every user has a proxy contract and all transactions are sent via the proxy contract. It is compatible with all existing smart contracts.
- **\_msgSender():** All transactions are sent via a single UniversalForwarder contract and the target contract must support the \_msgSender() standard. It preserves the user's signing key address as their identity.

Our meta-transaction library focuses on both approaches and we hope it benefits the community in the following way:

- **A Universal Forwarder**: Our RelayHub.sol can be used for the \_msgSender() standard.
- **Minimal wallet contract**: Our proxy contract only requires 67k gas to deploy & 26k gas per transaction. It is minimal code and supports batching transactions. As well, its replay protection supports out of order-transactions (bitflip) and concurrent transactions (multinonce).
- **GnosisSafe**: We have incorporated [GnosisSafe](https://github.com/gnosis/safe-contracts) and our library tracks the replay protection nonce such that it is meta-transaction friendly. It is an audited wallet contract that is increasingly widely used.

**Our repository is a protocol and relay-independent approach** that any project can adopt. We hope it will make it easier for projects to tap into third party relayer APIs and to avoid re-implementing the wheel for reliable transaction infrastructure.

# Getting started

We have put together a guide for the universal forwarder, proxy account and gnosis safe:

- Universal Forwarder: Tutorial to be completed soon.
- [GnosisSafe Forwarder](./gnosisSafe.md#gnosis-safe-forwarder): An audited wallet contract implementation by Gnosis and we follow the nonce signature path. Thus it is meta-transaction safe.
- [ProxyAccount Forwarder](./proxyAccounts.md#proxy-account-forwarder): Our own wallet contract implementation (not audited) with flexible replay protection and minimal overhead.

Our unit tests evaluate the gas costs for the wallet contracts:

| Name               | Deploy Wallet | 1st Transaction | 2nd Transaction | 10 Transactions (AVG) | 100 Transactions (AVG) | Meta-deployment Echo Contract |
| ------------------ | ------------- | --------------- | --------------- | --------------------- | ---------------------- | ----------------------------- |
| Gnosis Safe        | 223,240       | 39,014          | 24,014          | 24,009                | 24,011                 | 24,9179                       |
| Proxy (Bitflip)    | 67,303        | 39,718          | 24,698          | 24,701                | 24,704                 | 25,9423                       |
| Proxy (Multinonce) | 67,303        | 39,490          | 39,502          | 39,521                | 27,228                 | 25,9239                       |

**Deploy wallet**. Both proxy contracts are deployed using EIP-1167 which is the minimal clone factory technique. Whereas Gnosis Safe deploys a proxy contract using CREATE2 and then has ~5 storage operations during setup.

**1st Transaction**. All wallet contracts must initially set the `nonce` field which results in a higher gas cost.

**2nd Transaction**. Both Gnosis Safe and Proxy-bitflip are comparable as the `nonce` field is reused. Multinonce is higher as it supports multiple nonce queues. By default it maintains 10 queues and the implementation cycles through each nonce queue in turn.

**10 Transactions**.Both Gnosis Safe and Proxy-bitflip are comparable. Multinonce is higher as it supports multiple nonce queues. By default it maintains 10 queues an

**100 Transactions**. All wallet contracts have comparable gas costs. The nonce field is re-used for every new transaction. The gas cost for bitslip should be around 24k gas for 255 transactions, and then it needs to set a new `nonce` field which is 39k gas, then it will again be 24k gas for 255 transactions

**Meta-deployment Echo Contract.** All wallet contracts have comparable gas costs for deploying an echo contract. Each wallet contract delegate calls into a global deployer and the echo contract is deployed using CREATE2. We recommend deploying the contract and then calling an init() method (to avoid any msg.sender issues during deployment).
