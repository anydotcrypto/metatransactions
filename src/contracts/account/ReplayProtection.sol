pragma solidity 0.6.2;
pragma experimental ABIEncoderV2;

import "./IReplayProtectionAuthority.sol";

contract ReplayProtection {
    mapping(bytes32 => uint256) public nonceStore;

    event ReplayProtectionInfo(address replayProtectionAuthority, bytes replayProtection, bytes32 indexed txid);

    address constant public multiNonceAddress = 0x0000000000000000000000000000000000000000;
    address constant public bitFlipAddress = 0x0000000000000000000000000000000000000001;

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
     * Checks the signer's replay protection and returns the signer's address.
     * Reverts if fails.
     *
     * Why is there no signing authority? An attacker can supply an address that returns a fixed signer
     * so we need to restrict it to a "pre-approved" list of authorities (DAO).
     * @param _signer Address of the signer
     * @param _replayProtectionAuthority What replay protection will we check?
     * @param _replayProtection Encoded replay protection
     */
    function replayProtection(address _signer,
        bytes memory _replayProtection,
        address _replayProtectionAuthority) internal {

        // Check the user's replay protection.
        if(_replayProtectionAuthority == multiNonceAddress) {
            // Assumes authority returns true or false. It may also revert.
            require(nonce(_signer, _replayProtection), "Multinonce replay protection failed");
        } else if (_replayProtectionAuthority == bitFlipAddress) {
            require(bitflip(_signer, _replayProtection), "Bitflip replay protection failed");
        } else {
            // The final "else" ensures this require() is always hit and reverts if its bad.
            require(IReplayProtectionAuthority(_replayProtectionAuthority).updateFor(_signer, _replayProtection), "Replay protection from authority failed");
        }
    }

    /**
     * MultiNonce replay protection.
     * Explained: https://github.com/PISAresearch/metamask-comp#multinonce
     * Allows a user to send N queues of transactions, but transactions in each queue are accepted in order.
     * If queue==0, then it is a single queue (e.g. NONCE replay protection)
     * @param _signer Signer's address
     * @param _replayProtection Contains the two nonces
     */
    function nonce(address _signer, bytes memory _replayProtection) internal returns(bool) {
        uint256 queue;
        uint256 queueNonce;

        (queue, queueNonce) = abi.decode(_replayProtection, (uint256, uint256));
        bytes32 index = queueIndex(_signer, queue, multiNonceAddress);
        uint256 storedNonce = nonceStore[index];

        // Increment stored nonce by one...
        if(queueNonce == storedNonce) {
            nonceStore[index] = storedNonce + 1;
            return true;
        }

        return false;
    }
    /**
     * Bitflip Replay Protection
     * Explained: https://github.com/PISAresearch/metamask-comp#bitflip
     * Signer flips a bit for every new transaction. Each queue supports 256 bit flips.
     * @param _signer Signer's address
     * @param _replayProtection Contains the two nonces
     */
    function bitflip(address _signer, bytes memory _replayProtection) internal returns(bool) {
        (uint256 queue, uint256 bitsToFlip) = abi.decode(_replayProtection, (uint256, uint256));

        require(bitsToFlip > 0, "It must flip one bit!");

        // n & (n-1) == 0, i.e. is it a power of two?
        // example: 4 = 100, 3 = 011. 4 & = 000.
        require(bitsToFlip & bitsToFlip-1 == 0, "Only a single bit can be flipped");

        // Combine with msg.sender to get unique indexes per caller
        bytes32 index = queueIndex(_signer, queue, bitFlipAddress);
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
     */
    function queueIndex(address _signer, uint _queue, address _authority) internal pure returns(bytes32) {
        return keccak256(abi.encode(_signer, _queue, _authority));
    }

}
