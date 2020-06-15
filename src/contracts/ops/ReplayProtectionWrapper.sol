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
    function verifyPublic(bytes memory _callData,
        bytes memory _replayProtection,
        address _replayProtectionAuthority,
        address signer,
        bytes memory _signature) public {

        require(signer == verify(_callData, _replayProtection, _replayProtectionAuthority, _signature), "Not expected signer");
    }

    function noncePublic(address _signer, bytes memory _replayProtection) public {
        nonce(_signer, _replayProtection);
    }

    function bitflipPublic(address _signer, bytes memory _replayProtection) public {
        bitflip(_signer, _replayProtection);
    }

}
