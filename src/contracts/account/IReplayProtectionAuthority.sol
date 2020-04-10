pragma solidity 0.6.2;

/**
 * A nonce store stores nonces
 */
interface IReplayProtectionAuthority {
    /**
     * Update a nonce in the store.
     * It should update nonce for msg.sender.
     * Must return TRUE or revert/false.
     */
    function update(bytes calldata nonce) external returns (bool);

    /**
     * Update a nonce in the store.
     * It should update nonce for H(msg.sender || target).
     * Must return TRUE or revert/false.
     */
    function updateFor(address target, bytes calldata nonce) external returns (bool);

}
