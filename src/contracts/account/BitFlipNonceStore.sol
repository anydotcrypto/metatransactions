pragma solidity 0.6.2;
pragma experimental ABIEncoderV2;

import "./IReplayProtectionAuthority.sol";

/**
 * A nonce store allowing concurrent updates by setting unordered bits.
 *
 * The nonce store uses linearly increasing storage, using a new word at least
 * once every 256 nonce updates.
 *
 * Structure of the nonce is (bytes32, uint256) with optimally just a single bit specified in the uint256
 */
contract BitFlipNonceStore is IReplayProtectionAuthority {
    mapping(bytes32 => uint256) public bitmaps;

    /**
     * Updates the bits to flip at the given index.
     * The index is used to locate a current nonce, which is then combined with the
     * supplied uint256 "bitsToFlip" using the bitwise OR operator.
     */
    function update(bytes32 index, uint256 bitsToFlip) internal {
        uint256 currentBitmap = bitmaps[index];
        require(currentBitmap & bitsToFlip != bitsToFlip, "Nonce already used.");

        bitmaps[index] = currentBitmap | bitsToFlip;
    }

    /**
     * Updates the nonce if the nonce has not previously been used. Otherwise reverts.
     * Structure of the nonce is (bytes32, uint256) with a single bit specified in the uint256
     */
    function update(bytes memory nonce) override public returns (bool) {
        // The bytes32 param is used as an index for the uint256 param.
        // The index is used to locate a current nonce, which is then combined with the
        // supplied uint256 "bitsToFlip" using the bitwise OR operator.
        (bytes32 index, uint256 bitsToFlip) = abi.decode(nonce, (bytes32, uint256));
        // combine with msg.sender to get unique indexes per caller
        bytes32 senderIndex = keccak256(abi.encodePacked(msg.sender, index));

        update(senderIndex, bitsToFlip);
        return true;
    }

    /**
     * Updates the nonce for the supplied address if the nonce has not previously been used. Otherwise reverts.
     * Structure of the nonce is (bytes32, uint256) with a single bit specified in the uint256
     */
    function updateFor(address target, bytes memory nonce) override public returns (bool) {
        // The bytes32 param is used as an index for the uint256 param.
        // The index is used to locate a current nonce, which is then combined with the
        // supplied uint256 "bitsToFlip" using the bitwise OR operator.
        (bytes32 index, uint256 bitsToFlip) = abi.decode(nonce, (bytes32, uint256));
        // hash the index with the target and msg.sender to get a unique index per target/caller
        bytes32 targetIndex = keccak256(abi.encodePacked(msg.sender, target, index));

        update(targetIndex, bitsToFlip);
        return true;
    }
}
