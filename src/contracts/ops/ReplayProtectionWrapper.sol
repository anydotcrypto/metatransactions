pragma solidity 0.6.2;
pragma experimental ABIEncoderV2;

import "../account/ReplayProtection.sol";

/**
  USED FOR TESTING PURPOSES ONLY
 */
contract ReplayProtectionWrapper is ReplayProtection {

    /**
     * Easy wrapper to access ReplayProtection.verify(), an internal method.
     */
    function verifyPublic(
        bytes memory _replayProtection,
        ReplayProtectionType _replayProtectionType,
        address signer) public {

        verifyReplayProtection(_replayProtection, _replayProtectionType, signer, keccak256(abi.encode("any.sender")));
    }

    function noncePublic(bytes memory _replayProtection, address _signer) public {
        nonce(_replayProtection, _signer);
    }

    function bitflipPublic(bytes memory _replayProtection, address _signer) public {
        bitflip(_replayProtection, _signer);
    }

}
