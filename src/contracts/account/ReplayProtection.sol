pragma solidity 0.6.2;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/cryptography/ECDSA.sol";

contract ReplayProtection {
    mapping(bytes32 => uint256) public nonceStore;

    enum ReplayProtectionType {
        MULTINONCE,
        BITFLIP
    }

    event ReplayProtectionInfo(ReplayProtectionType replayProtectionType, bytes replayProtection, address signer, bytes32 indexed txid);

    /**
     * Get Ethereum Chain ID
     * */
    function getChainID() public pure returns(uint) {
        // Fetch chainId
        uint256 chainId;
        assembly {chainId := chainid() }
        return chainId;
    }

    /**
     * Checks the signer's replay protection.
     * Reverts if fails.
     * @param _replayProtectionType What replay protection will we check?
     * @param _replayProtection Encoded replay protection
     * @param _signer Signer's address
     */
    function verifyReplayProtection(
        bytes memory _replayProtection,
        ReplayProtectionType _replayProtectionType,
        address _signer, bytes32 _txid) internal {
        
        // Check the user's replay protection.
        if(_replayProtectionType == ReplayProtectionType.MULTINONCE) {
            // Assumes authority returns true or false. It may also revert.
            require(nonce(_replayProtection, _signer), "Multinonce replay protection failed");
        } else {
            require(bitflip(_replayProtection, _signer), "Bitflip replay protection failed");
        }

        emit ReplayProtectionInfo(_replayProtectionType, _replayProtection, _signer, _txid);
    }

    /**
     * MultiNonce replay protection.
     * Explained: https://github.com/PISAresearch/metamask-comp#multinonce
     * Allows a user to send N queues of transactions, but transactions in each queue are accepted in order.
     * If queue==0, then it is a single queue (e.g. NONCE replay protection)
     * @param _replayProtection Nonce queue and nonce to increment (uint,uint)
     * @param _signer Signer's address
     */
    function nonce(bytes memory _replayProtection, address _signer) internal returns(bool) {
        (uint queue, uint nonceInQueue) = abi.decode(_replayProtection, (uint256, uint256));
        bytes32 index = queueIndex(_signer, queue, ReplayProtectionType.MULTINONCE);
        uint256 storedNonce = nonceStore[index];

        // Increment stored nonce by one...
        if(nonceInQueue == storedNonce) {
            nonceStore[index] = storedNonce + 1;
            return true;
        }

        return false;
    }
    /**
     * Bitflip Replay Protection
     * Explained: https://github.com/PISAresearch/metamask-comp#bitflip
     * Signer flips a bit for every new transaction. Each queue supports 256 bit flips.
     * @param _replayProtection Nonce queue and the bit to flip (uint,uint)
     * @param _signer Signer's address
     */
    function bitflip(bytes memory _replayProtection, address _signer) internal returns(bool) {
        (uint256 queue, uint256 bitsToFlip) = abi.decode(_replayProtection, (uint256, uint256));

        require(bitsToFlip > 0, "It must flip one bit!");

        // n & (n-1) == 0, i.e. is it a power of two?
        // example: 4 = 100, 3 = 011. 4 & = 000.
        require(bitsToFlip & bitsToFlip-1 == 0, "Only a single bit can be flipped");

        // Combine with msg.sender to get unique indexes per caller
        bytes32 index = queueIndex(_signer, queue, ReplayProtectionType.BITFLIP);
        uint256 currentBitmap = nonceStore[index];

        // This is an AND operation, so if the bitmap
        // and the bitsToFlip share no common "1" bits,
        // then it will be 0. We require bitsToFlip > 0,
        // to ensure there is always a bit to flip.
        if(currentBitmap & bitsToFlip == 0) {
            nonceStore[index] = currentBitmap | bitsToFlip;
            return true;
        }
        return false;
    }

    /**
     * A helper function for computing the queue index identifier.
     * @param _signer Signer's address
     * @param _queue Queue index
     * @param _replayProtectionType Multinonce or Bitflip
     */
    function queueIndex(address _signer, uint _queue, ReplayProtectionType _replayProtectionType) public pure returns(bytes32) {
        return keccak256(abi.encode(_signer, _queue, _replayProtectionType));
    }

}
