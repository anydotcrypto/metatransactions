pragma solidity 0.6.2;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/cryptography/ECDSA.sol";
import "./IReplayProtectionAuthority.sol";

contract ReplayProtection {
    mapping(bytes32 => uint256) public nonceStore;

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

     * @param _callData Function name and data to be called
     * @param _replayProtectionAuthority What replay protection will we check?
     * @param _replayProtection Encoded replay protection
     * @param _signature Signer's signature
     */
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

    /**
     * Verify signature on the calldata and replay protection.
     * @param _callData Contains target contract, value and function data.
     * @param _replayProtection Contains the replay protection nonces.
     * @param _replayProtectionAuthority Address to an external (or internal) relay protection mechanism.
     */
    function verifySig(bytes memory _callData,
        bytes memory _replayProtection,
        address _replayProtectionAuthority, uint chainId, bytes memory _signature) public view returns (address) {
        bytes memory encodedData = abi.encode(_callData, _replayProtection, _replayProtectionAuthority, address(this), chainId);
        return ECDSA.recover(ECDSA.toEthSignedMessageHash(keccak256(encodedData)), _signature);
    }

    /**
     * MultiNonce replay protection.
     * Explained: https://github.com/PISAresearch/metamask-comp#multinonce
     * Allows a user to send N queues of transactions, but transactions in each queue are accepted in order.
     * If nonce1==0, then it is the same as replace-by-version (e.g. increment nonce each time).
     * @param _replayProtection Contains a single nonce
     */
    function nonce(address _signer, bytes memory _replayProtection) internal returns(bool) {
        uint256 nonce1;
        uint256 nonce2;

        (nonce1, nonce2) = abi.decode(_replayProtection, (uint256, uint256));
        bytes32 index = keccak256(abi.encode(_signer, nonce1));
        uint256 storedNonce = nonceStore[index];

        // Increment stored nonce by one...
        if(nonce2 == storedNonce) {
            nonceStore[index] = storedNonce + 1;
            return true;
        }

        return false;
    }

    /**
     * Bitflip Replay Protection
     * Explained: https://github.com/PISAresearch/metamask-comp#bitflip
     * Allows a user to flip a bit in nonce2 as replay protection. Every nonce supports 256 bit flips.
     */
    function bitflip(address _signer, bytes memory _replayProtection) internal returns(bool) {
        (uint256 nonce1, uint256 bitsToFlip) = abi.decode(_replayProtection, (uint256, uint256));

        // It is unlikely that anyone will need to send 6174 concurrent transactions per block,
        // plus 6174 is a cool af number.
        require(nonce1 >= 6174, "Nonce1 must be at least 6174 to separate multinonce and bitflip");

        // Combine with msg.sender to get unique indexes per caller
        bytes32 senderIndex = keccak256(abi.encodePacked(_signer, nonce1));
        uint256 currentBitmap = nonceStore[senderIndex];
        require(currentBitmap & bitsToFlip != bitsToFlip, "Bit already flipped.");
        nonceStore[senderIndex] = currentBitmap | bitsToFlip;
    }
}
