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

It is common practice to authenticate the immediate caller of a contract using msg.sender. An immediate caller can be the externally owned account that signed the Ethereum Transaction or another smart contract. We propose a third option, `callWithSigner()`, that checks if an externally owned account has authorised the command (alongside relevant replay protection) before calling the target contract. If the checks pass, then the target contract is invokved and msg.sender is assigned as the externally owned account.

## Motivation

The idea of a [meta-transaction](https://medium.com/@austin_48503/ethereum-meta-transactions-90ccf0859e84) was first popularized by Austin Griffth as a mechanism to onboard new users by paying for their gas. It allows an externally owned account (Bob) to sign a command and for another party (Alice) to take on the responsibility of publishing it to the network (alongside paying the gas fee). What makes the mechanism truly useful is that Bob can outsource his entire transaction infrastructure in a non-custodial manner to Alice. She takes on the role of a [non-custodial proxy-bidder](https://ethresear.ch/t/first-and-second-price-auctions-and-improved-transaction-fee-markets/2410/5) in the network's fee market. We are starting to witness the uptake of meta-transactions with third party wallet providers, dapps that pay gas for their users, and relayer APIs.

There are two existing solutions that try to solve the problem, but they have the following shortcomings:

**Proxy contract**. This approach requires users to migrate their funds into a proxy contract. While the additional work-flow of deploying a proxy contract and transferring funds is inconvenient for adoption, the real hurdle is the additional security risks associated with storing funds in a smart contract and whether users will trust the solution due to significant events like the Parity Wallet hack. As well, a subtle problem is how to migrate way/recover from the situation when the provider of the proxy contract disappears (e.g. the wallet manages the proxy contract and discontinues its service, but no other service is using the same approach).

**Upgrade target contract**. This approach requires the target contract to natively support meta-transactions and it does not work for pre-existing smart contracts. The `Permit()` function is intrusive as it requires the target contract to natively handle replay protection (e.g. verify the user's signature and then increment nonce by 1). `msgSender()` tries to alleviate the contract intrusiveness as the replay protection is handled by a global singleton RelayHub contract and the target contract is only required to replace msg.sender with msgSender() . So far no single approach has achieved wide-spread adoption and this is most evident in [Gnosis Safe](https://github.com/gnosis/safe-contracts/blob/development/contracts/GnosisSafe.sol#L193) that implements three solutions to the msg.sender problem. This includes 1) checking a signed message from the externally owned account that is not compatible with Permit(), 2) checking the message hash for uniquness and 3) checking contract signatures via EIP-1271.

The fragmentation of solutions to the msg.sender problem is evident that it is indeed a real problem faced by contract developers. They have tried to solve it at the contract-level, but it is fundamentally a platform issue. This motivates us to propose a new opcode `callWithSigner()` that can be implemented in the EVM. As a bonus point, the opcode `tx.origin` will finally have a meaningful purpose and it should be renamed `tx.gaspayer`.

## Specification

We propose `callWithSigner()` that checks:

- The externally owned account has signed and authorised the call (e.g. target contract and its calldata)
- The signed replay protection is unique (e.g. this is the first and only time the command is executed)

If both checks pass, then the target contract is invoked with the desired calldata and the signer's address is set as msg.sender. Of course, this proposal requires the new opcode to maintain storage as it must keep track of the replay protection used so far by all signers.

For the replay protection, we propose using [MultiNonce](https://github.com/PISAresearch/metamask-comp/tree/master#multinonce). Conceptually, the user has a list of nonce queues and in each queue the nonce must strictly increment by one. MultiNonce supports up to N concurrent transactions at any time and potentially requires the same storage as a single nonce queue.

For the interface, we propose:

```
targetContract.callWithSigner(callData, replayProtection, signature,  signer)
```

It has the following parameters:  
`targetContract`: Address of the target contract. Same as CALL.
`calldata`: Encoded function name and data. Same as CALL.
`replayProtection`: Encoded replay protection of two nonces (queue and queueNonce)
`signature`: Authorised command signed by the user
`signer`: Externally owned account address

We assume the following encoding / signing:

`replayProtection` -> `abi.encode(["uint","uint"],[queue,queueNonce]);`
`signature` -> `Sign(keccak256(targetContract, callData, replayProtection, chainid))`

The additional `chainid` is to verify the signature is for the target blockchain (mainnet/ropsten/etc).

To specify how to implement callWithSigner we provide an example in pseudo-Solidity for ease of reading.

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
function verifySig(address _targetContract, bytes memory _callData, bytes memory _replayProtection, bytes memory _signature) public view returns (address) {

    bytes memory encodedData = abi.encode(_targetContract, _callData, _replayProtection,  this.chainid);

    return ECDSA.recover(ECDSA.toEthSignedMessageHash(keccak256(encodedData)), _signature);
}
```

Altogether the final functionality:

```
function callWithSigner(address _targetContract, bytes memory _callData, bytes memory _replayProtection, bytes memory _signature, address _signer) public {

    require(verifyReplayProtection(_replayProtection, _signer), "Replay protection is not valid");
    require(signer == verifySignature(_targetContract, _callData, _replayProtection, _signature), "Signer did not authorise this command");

    msg.sender = signer; // Override msg.sender to be signer
    _targetContract.call(_callData);
}
```

As we can see in the above, the opcode simply checks replay protection and the signer's signature before overriding msg.sender and then executing a normal .call().

## Rationale

The rationale to favor a new opcode is the following:

- **Non-intrusive change**. It does not impact existing tooling or wallets. They can simply ignore the new opcode unless it is required.
- **Minimal functionality**. The only job of the new opcode is to check the user has signed the message and that it has not been replayed. Thus it is emulating the existing Ethereum Account system, but at the EVM level.
- **Application logic surrounding the opcode**. Relayers like any.sender and GSN implement logic before forwarding the call (e.g. to record a log the job was done or to reward the relayer). By making it an opcode and not as an Ethereum Transaction, it is easy to wrap additional logic around it.

There are two alternative approaches that we describe below.

**Pre-signed Ethereum Transaction.** Instead of the interface/data structure proposed in this EIP, another approach is to supply a pre-signed Ethereum Transaction to the new opcode. The advantage is that we can re-use the existing account system for the replay protection, re-use significant portions of code (both in the node and client-side) to verify/generate the transaction. However, it likely has a larger data-structure overhead (e.g. RLP decoding, additional fields, etc), it mixes the replay protection of both systems (which may not be desirable) and it limits the signer to NONCE replay protection (single queue). We mention the approach as it is a desirable alternative that should be considered.

**Modify Ethereum Transaction**. An alternative approach for solving the problem is to modify the structure of an Ethereum Transaction to include a new field for the signer's address, signature/replayprotection and the command. The EVM can simply check if the fields are filled in are correct before swapping msg.sender with the signer's address. Of course, if the fields are omitted, then msg.sender == tx.origin. However modifying the structure of an Ethereum Transaction is an intrusive and significant change. It may require all wallets and tooling to upgrade to support the new EIP. Thus the rationale for the new opcode is the following:

We provide some brief information in regards to related work:

[Account abstraction](https://docs.ethhub.io/ethereum-roadmap/ethereum-2.0/account-abstraction/). This work aims to remove the the distinction of externally owned accounts and contract accounts. While the original account abstraction proposal is a drastic change and may not be implemented in ETH1, our proposal for callWithSigner is way to implement something similar to account abstraction. The opcode can be wrapped in contract logic while keeping the signer's address as msg.sender. As such all transactions are sent via a contract wallet, the contract logic is procesed, and then the signer's address is kept when calling the target contract. **We highlight our goal is to work with the existing account system, but it may enable a subset of account abstraction.**

[Rich transaction precompile](https://github.com/Arachnid/EIPs/blob/f6a2640f48026fc06b485dc6eaf04074a7927aef/EIPS/EIP-draft-rich-transactions.md). This work lets a signer execute a batch of calls in a single Ethereum Transaction while maintaining msg.sender as the signer of the transaction. It is desirable to streamline the user experience (e.g. one transaction to perform several actions). Our proposal for callWithSigner can achieve a similar effect as the contract code that surrounds the the opcode can be used to send a batch of transactions. For example:

```
for(uint i=0; i<transactions.length; i++) {
    transactions[i].targetContract.callWithSigner(.....);
}
```

Thus it is complementary to the rich transaction precompile approach and this EIP requires less intrusive changes as it does not impact the transaction format or how it is interpreted.

## Backwards Compatibility

This EIP does not impact any existing smart contract on Ethereum. It adds functionality, but does not remove any. It must be implemented as a hard-fork on the network and thus all clients must upgrade to use it.

## Test Cases

<!--Test cases for an implementation are mandatory for EIPs that are affecting consensus changes. Other EIPs can choose to include links to test cases if applicable.-->

Replay protection testcases:

- For queue=0, the first nonce=0 is accepted. first nonce=0 for queue=0 is accepted.
- For queue=0, the nonce is accepted if it is incremented sequentially.
- For queue=0, the nonce is rejected if it has skipped a number (e.g. nonce=3 instead of nonce=1).
- For queues [0,...,50], the first nonce=0 is accepted.
- For queues [0,...,50], the nonce is incremented sequentially for each queue and it is accepted.
- For queue=0 and queue=3, the first nonce=0 is accepted.
- Replay protection is rejected due to bad encoding (e.g. 3 uints instead of 2)

Signature testcases:

- Signature is valid if the replay protection and target contract/calldata is valid.
- It will not verify the user's signature if the replay protection is invalid/used already.

Call testcases. In all cases, if the transaction passes, then it should test that msg.sender is the signer's address:

- Transaction should succeed if the target contract and calldata is executed.
- Transaction should succeed if calldata requires more than 1 argument.
- Transaction should revert if the target contract and calldata do not match.

More tests can and should be added. The above is a small sample for the initial draft of the EIP.

## Implementation

We do not yet have an implementation of the new opcode/precompile. But we provided an example in pseudo-Solidity for the specification. This should provide clarity on how it can be implemented if this EIP moves to that stage.

## Security Considerations

Our proposal is potentially the first opcode/precompile that requires persistent storage which may come with its own security/reliability challenges. Furthermore if the replay protection or signature verification is not implemented correctly, then it can facilitate impersonation and/or replay attacks. The final implementation code should be small and the project is well-scoped, so it should be reasonable to audit.

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
