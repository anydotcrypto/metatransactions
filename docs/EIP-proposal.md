---
eip: <to be assigned>
title: CallWithSigner - A new CALL opcode to replace msg.sender with the signer's address
author:
discussions-to: <URL>
status: draft
type: Standards Track
category: Core
created: 2020-05-11
---

## Simple Summary

Ethereum transaction's intertwine the identity of who paid for the transaction (tx.gaspayer) and who wants to execute a command (msg.sender). As a result, it is not straight forward for Alice to pay the gas fee on behalf of Bob who wants to execute a command in a smart contract. If this issue can be fixed, then it allows Bob, without any significant hurdles, to outsource his transaction infrastructure to Alice in a non-custodial manner. This EIP aims to alleviate the issue by introducing a new opcode, `callWithSigner()`, in the EVM.

## Abstract

It is common practice to authenticate the immediate caller of a contract using msg.sender. An immediate caller can be the externally owned account that signed the Ethereum Transaction or another smart contract. We propose a third option, `callWithSigner()`, that checks if an externally owned account has authorised the command (alongside relevant replay protection) before calling the target contract. If the checks pass, then the target contract is invoked and externally owned account is assigned as msg.sender.

## Motivation

The idea of a [meta-transaction](https://medium.com/@austin_48503/ethereum-meta-transactions-90ccf0859e84) was first popularized by Austin Griffth as a mechanism to onboard new users by paying for their gas. It allows an externally owned account (Bob) to sign a command and for another party (Alice) to take on the responsibility of publishing it to the network (alongside paying the gas fee). What makes the mechanism truly useful is that Bob can outsource his entire transaction infrastructure in a non-custodial manner to Alice. She takes on the role of a [non-custodial proxy-bidder](https://ethresear.ch/t/first-and-second-price-auctions-and-improved-transaction-fee-markets/2410/5) in the network's fee market. We are starting to witness the uptake of meta-transactions with third party wallet providers, dapps that pay gas for their users, and relayer APIs.

There are two existing solutions that try to solve the problem, but they have the following shortcomings:

**Proxy contract**. Each user has their own proxy contract. They must migrate funds into the proxy contract and all transactions are sent via the proxy contract. As such, the msg.sender is set as the proxy contract address. There are three hurdles for proxy contracts:

1. **Workflow issues.** There is an additional and inconvenient work-flow of deploying a proxy contract and transferring funds. This can hinder adoption as it is not a straight-forward plug & play experience.
2. **Two addresses.** The user now has two addresses which includes the signing address and the proxy contract address. This needs to be managed as part of the user experience and some dapps may need to take it into account.
3. **Trust issues.** Users may have trust issues with storing funds in a smart contract due to the additional security risks. Several events including the Parity Wallet Hack exacerbate the problem.

Finally there is a subtle problem on how to recover (and migrate away) from the proxy contract if the provider disappears. For example, if the wallet managing access to the proxy contract discontinues its service, but no other service is using the same standard.

**Upgrade target contract**. This approach requires the target contract to natively support meta-transactions and it does not work for pre-existing smart contracts. There are two popular approaches:

1. The `Permit()` function is intrusive as it requires the target contract to natively handle replay protection (e.g. verify the user's signature and then increment nonce by 1).

2. `msgSender()` tries to alleviate the contract intrusiveness as a global singleton RelayHub contract is responsible for handling the replay protection. The target contract is only required to replace msg.sender with msgSender() .

So far no single approach has achieved wide-spread adoption and this is most evident in [Gnosis Safe](https://github.com/gnosis/safe-contracts/blob/development/contracts/GnosisSafe.sol#L193) that implements three solutions to the msg.sender problem. This includes checking a signed message from the externally owned account that is not compatible with Permit(), checking the message hash for uniqueness (i.e. a form of replay protection) and finally checking contract signatures via EIP-1271.

The fragmentation of solutions to the msg.sender problem is evident that it is indeed a real problem faced by contract developers. They have tried to solve it at the contract-level, but it is fundamentally a platform issue. This motivates us to propose a new opcode `callWithSigner()` that can be implemented in the EVM. As a bonus point, the opcode `tx.origin` will finally have [a meaningful purpose](https://github.com/ethereum/solidity/issues/683) and it should be renamed `tx.gaspayer`.

## Specification

We propose `callWithSigner()` that checks:

- The externally owned account has signed and authorised the call (e.g. target contract and its calldata)
- The replay protection is unique (e.g. this is the first and only time the command is executed)

If both checks pass, then the target contract is invoked with the desired calldata and the signer's address is set as msg.sender. Of course, the new opcode requires long-term storage to keep track of the latest replay protection used (e.g. it is achieved with a single mapping that links the signer's address to the latest nonce).

For the replay protection, we propose using [MultiNonce](https://github.com/PISAresearch/metamask-comp/tree/master#multinonce). Conceptually, the user has a list of nonce queues and in each queue the nonce must strictly increment by one. MultiNonce supports up to N concurrent transactions at any time and potentially requires the same storage as a single nonce queue.

For the interface, we propose:

```
targetContract.callWithSigner(callData, value, replayProtection, signature,  signer)
```

It has the following parameters:

- `targetContract`: Address of the target contract. Same as CALL.
- `calldata`: Encoded function name and data. Same as CALL.
- `value`: Quantity of ETH to send in WEI. Same as CALL.
- `replayProtection`: Encoded replay protection of two nonces (queue and queueNonce)
- `signature`: Authorised command signed by the user
- `signer`: Externally owned account address

We assume the following for the encoding and the signing:

- `replayProtection` -> `abi.encode(["uint","uint"],[queue,queueNonce]);`
- `signature` -> `Sign(keccak256(targetContract, callData, value, replayProtection, chainid))`

The additional `chainid` is to verify the signature is for the target blockchain (mainnet/ropsten/etc).

At a high level, the opcode executes as follows:

- Verify the signer's signature over the target contract, callData, replayProtection and the chainid. (Defensive approach: We check against supplied signer address).
- Verify the signer has sufficient balance for the call (signer.balance > value)
- Decode reply protection for queue and queueNonce.
- Compute signer queue index with queueIndex = H(signer, queue)
- Fetch latest storedNonce for the queue
- Check that queueNonce == storedNonce, if so increment by one and store it. If not, revert.
- Change msg.sender to the signer's address.
- Call into the target contract with the supplied callData and the signer's value in WEI. (value taken from the global account system balanace).

We provide the rest of this specification in pseudo-Solidity for ease of reading (and its motivation originates [from here](https://github.com/anydotcrypto/metatransactions/blob/master/src/contracts/account/RelayHub.sol).

We assume there is a global mapping of replay protection:

```
mapping(bytes32 => uint256) public nonceStore;
```

The opcode needs to check the replay protection is valid:

```
// Check the signer's replay protection is valid
function verifyReplayProtection(address _signer, bytes memory _replayProtection) internal returns(bool) {

    uint queue; uint queueNonce;
    (queue, queueNonce) = abi.decode(_replayProtection, (uint256, uint256));

    // Notice the signer's address and queue computes the index
    bytes32 queue = keccak256(abi.encode(_signer, _queue));
    uint256 storedNonce = nonceStore[queue];

    if(queueNonce == storedNonce) {
        nonceStore[index] = storedNonce + 1;
        return true;
    }

    return false;
}
```

The opcode needs to verify the signer's signature:

```
function verifySig(address _targetContract, bytes memory _callData, uint _value, bytes memory _replayProtection, bytes memory _signature) public view returns (address) {

    bytes memory encodedData = abi.encode(_targetContract, _callData, _value, _replayProtection,  this.chainid);

    return ECDSA.recover(keccak256(encodedData), _signature);
}
```

Altogether the final functionality:

```
function callWithSigner(address _targetContract, bytes memory _callData, uint _value, bytes memory _replayProtection, bytes memory _signature, address _signer) public {

    require(verifyReplayProtection(_replayProtection, _signer), "Replay protection is not valid");

    require(signer == verifySignature(_targetContract, _callData, _replayProtection, _signature), "Signer did not authorise this command");

    msg.sender = signer; // Override msg.sender to be signer
    _targetContract.call(_value)(_callData);
}
```

As we can see in the above, the opcode checks the replay protection and the signer's signature before overriding msg.sender and then executing a normal .call().

## Rationale

The rationale to favor a new opcode is the following:

- **Non-intrusive change**. It does not impact existing tooling or wallets. They can simply ignore the new opcode unless it is required.
- **Minimal functionality**. The only job of the new opcode is to check the user has signed the message and that it has not been replayed. Thus it is emulating the existing Ethereum Account system, but at the EVM level.
- **Application logic surrounding the opcode**. Relayers like any.sender and GSN implement logic before forwarding the call (e.g. to record a log the job was done or to reward the relayer). By making it an opcode and not as an Ethereum Transaction, it is easy to wrap additional logic around it.

There are two alternative approaches that we describe below.

**Pre-signed Ethereum Transaction.** It is possible to supply a pre-signed Ethereum Transaction to the new opcode. We can re-use the existing account system for the replay protection and re-use significant portions of code (both in the node and client-side) to handling the transaction. However, it does involve a more complicated data-structure (e.g. RLP decoding, additional fields, etc) and it may not be desirable to mix the replay protection of both systems. As well, it limits the signer to NONCE replay protection (single queue). We mention the approach as it is a desirable alternative that should be considered and it has been implemented in the [GSN](https://github.com/opengsn/gsn/blob/master/contracts/Penalizer.sol#L28).

**Modify Ethereum Transaction**. We can modify the structure of an Ethereum Transaction to include a new field for the signer's address, signature & replay protection and the calldata. The EVM can check if the fields are filled in are correct before swapping msg.sender with the signer's address. Of course, if the fields are omitted, then msg.sender == tx.origin. However modifying the structure of an Ethereum Transaction is an intrusive and significant change. It may require all wallets and tooling to upgrade to support the new EIP.

We provide some brief information in regards to related work:

[Account abstraction](https://docs.ethhub.io/ethereum-roadmap/ethereum-2.0/account-abstraction/). It removes the distinction of externally owned accounts and contract accounts. In a way, it is similar to the proxy contract approach where the user's funds are stored in the contract wallet and that is the default msg.sender on the network. As a result, this EIP may not be required as there is no such thing as an 'externally owned account' and thus the signer's address is never used as msg.sender.

[(EIP not assigned) Rich transaction precompile](https://github.com/Arachnid/EIPs/blob/f6a2640f48026fc06b485dc6eaf04074a7927aef/EIPS/EIP-draft-rich-transactions.md). It lets a signer execute a batch of calls in a single Ethereum Transaction while maintaining msg.sender as the signer of the transaction. It is desirable to streamline the user experience (e.g. one transaction to perform several actions). Our proposal for callWithSigner can achieve a similar effect as the contract code that surrounds the the opcode can be used to send a batch of transactions. For example:

```
for(uint i=0; i<transactions.length; i++) {
    transactions[i].targetContract.callWithSigner(.....);
}
```

Thus it is complementary to the rich transaction precompile approach and this EIP requires less intrusive changes as it does not impact the transaction format or how it is interpreted.

[EIP1035 - Transaction execution batching and delegation](https://github.com/ethereum/EIPs/issues/1035). It has a similar motivation to our EIP, but it tries to solve it with a new standard solidity function:

```
function authorizedcall(bytes data, address account, uint256 nonce, uint256 chain_id, bytes signature);
```

We believe our EIP extends it with improved replay protection (MultiNonce) and a plan to incorporate it into the EVM. The name `authorizedcall` can be used for the our proposed precompile/opcode.

## Backwards Compatibility

This EIP does not impact any existing smart contract on Ethereum. It adds functionality, but does not remove any. It must be implemented as a hard-fork on the network and thus all clients must upgrade to use it.

## Test Cases

In all cases, if the transaction passes, then it should test that msg.sender is the signer's address:

Replay protection:

- For queue=0, the first nonce=0 is accepted. first nonce=0 for queue=0 is accepted.
- For queue=0, the nonce is accepted if it is incremented sequentially.
- For queue=0, the nonce is rejected if it has skipped a number (e.g. nonce=3 instead of nonce=1).
- For queues [0,...,50], the first nonce=0 is accepted.
- For queues [0,...,50], the nonce is incremented sequentially for each queue and it is accepted.
- For queue=0 and queue=3, the first nonce=0 is accepted.
- Replay protection is rejected due to bad encoding (e.g. 3 uints instead of 2)

Signature verification:

- Signature is valid if the replay protection and target contract/calldata is valid.
- It will not verify the user's signature if the replay protection is invalid/used already.

Call:

- Transaction should succeed if the target contract and calldata is executed.
- Transaction should succeed if calldata requires more than 1 argument.
- Transaction should revert if the target contract and calldata do not match.

More tests can and should be added. The above is a small sample for the initial draft of the EIP.

## Implementation

We do not yet have an implementation of the new opcode/precompile. But we provided an example in pseudo-Solidity for the specification. This should provide clarity on how it can be implemented if this EIP moves to that stage.

## Security Considerations

- First opcode/precompile that requires persistant storage
- Potential impersonation attacks if there is a bug in the signature verification
- Potential replay-attack problems if there is a bug in the replay protection
- Cost for creating a new nonce queue should be greater than re-using an existing nonce queue.
- We authenticate the blockchain via the ChainID. If two blockchains share the same ChainID, it may facilitate replay attacks.

Given the final implementation code should be relatively small and the project is well-scoped, it should be reasonable to audit.

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
