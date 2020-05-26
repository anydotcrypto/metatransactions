pragma solidity 0.6.2;
pragma experimental ABIEncoderV2;

import "../account/ContractCall.sol";
/**
 * We deploy a new contract to bypass the msg.sender problem.
 */
contract CallWrapper is ContractCall {

    /**
     * Delegate calls into the target contract. Useful for adding functionality to the proxy.
     * @param _target Target contract
     * @param _callData Function name plus arguments
     */
    function delegateCall(address _target, bytes memory _callData) public payable returns(bool) {
        (bool success, bytes memory revertReason) = _target.delegatecall(abi.encodePacked(_callData));

        if(!success) {
            emit Revert(getRevertMsg(revertReason));
        }

        return success;
    }

    receive() external payable {}
}
