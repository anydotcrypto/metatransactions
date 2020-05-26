pragma solidity 0.6.2;
pragma experimental ABIEncoderV2;

/**
 * Common CALL functionality for the proxy contract and relayhub
 */
contract ContractCall {

    enum CallType {CALL, DELEGATE, BATCH}
    event Revert(string reason);

    // https://ethereum.stackexchange.com/questions/83528/how-can-i-get-the-revert-reason-of-a-call-in-solidity-so-that-i-can-use-it-in-th/83529#83529
    /// @dev Get the revert message from a call
    /// @notice This is needed in order to get the human-readable revert message from a call
    /// @param _returnData Response of the call
    /// @return Revert message string
    function getRevertMsg(bytes memory _returnData) internal pure returns (string memory) {
        // If the _res length is less than 68, then the transaction failed silently (without a revert message)
        if (_returnData.length < 68) return 'Transaction reverted silently';

        assembly {
            // Slice the sighash.
            _returnData := add(_returnData, 0x04)
        }
        return abi.decode(_returnData, (string)); // All that remains is the revert string
    }

    /**
     * Executes the call and extracts the revert message if it fails.
     * @param _target Target contract
     * @param _value Quantity of eth in account contract to send to target
     * @param _callData Function name plus arguments
     */
    function forwardCall(address _target, uint _value, bytes memory _callData) internal returns(bool) {
        (bool success, bytes memory revertReason) = _target.call{value: _value}(abi.encodePacked(_callData));

        if(!success) {
            emit Revert(getRevertMsg(revertReason));
        }

        return success;
    }

    /**
     * Delegate calls into the target contract. Useful for adding functionality to the proxy.
     * @param _target Target contract
     * @param _callData Function name plus arguments
     */
    function delegate(address _target, bytes memory _callData) internal returns(bool) {
        (bool success, bytes memory revertReason) = _target.delegatecall(abi.encodePacked(_callData));

        if(!success) {
            emit Revert(getRevertMsg(revertReason));
        }

        return success;
    }

}
