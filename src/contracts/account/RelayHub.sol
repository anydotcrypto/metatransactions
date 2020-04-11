pragma solidity 0.6.2;
pragma experimental ABIEncoderV2;

import "./ReplayProtection.sol";

/**
 * A minimal relay hub contract.
 * Verifies the signer's signature and replay protection before forwarding calldata to the target.
 * Delegates nonce verification to another contract.
 */
contract RelayHub is ReplayProtection {

     /**
     * Each signer has a contract account (signers address => contract address).
     * We check the signer has authorised the target contract and function call. Then, we pass it to the
     * signer's contract account to perform the final execution (to help us bypass msg.sender problem).
     * @param _target Target contract
     * @param _value Quantity of eth in account contract to send to target
     * @param _callData Function name plus arguments
     * @param _replayProtection Replay protection (e.g. multinonce)
     * @param _replayProtectionAuthority Identify the Replay protection, default is address(0)
     * @param _signature Signature from signer
     */
    function forward(
        address _target,
        uint _value, // only used for accounts
        bytes memory _callData,
        bytes memory _replayProtection,
        address _replayProtectionAuthority,
        bytes memory _signature) public {

        bytes memory encodedCallData = abi.encode(_target, _value, _callData);

        // // Reverts if fails.
        address signer = verify(encodedCallData, _replayProtection, _replayProtectionAuthority, _signature);

        // Check if the user wants to send command from their contract account or signer address
        (bool success,) = _target.call(abi.encodePacked(_callData, signer));
        require(success, "Forwarding call failed.");
    }

}
