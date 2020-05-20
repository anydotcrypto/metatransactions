pragma solidity 0.6.2;
pragma experimental ABIEncoderV2;

// Send a batch of transaction.
// @author Patrick McCorry

contract MultiSendInternal {

    /// @dev Sends multiple transactions and reverts all if one fails.
    /// @param _to Target contracts
    /// @param _data Calldata for target contract
    /// @param _revertIfFail Do we revert entire transaction if the corresponding .call() fails?
    function batchInternal(address[] memory _to, bytes[] memory _data, bool[] memory _revertIfFail) internal
    {
        require(_to.length == _data.length && _data.length == _revertIfFail.length, "All arrays must have the same length");

        for(uint i=0; i<_to.length; i++) {
            (bool success,) = _to[i].call(_data[i]);
            if(_revertIfFail[i]) {
                require(success, "Forwarding call failed.");
            }
        }
    }
}