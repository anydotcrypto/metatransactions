pragma solidity 0.6.2;
pragma experimental ABIEncoderV2;

import "../account/RevertMessage.sol";

/**
 * Common CALL functionality for the proxy contract and relayhub
 */
contract RevertMessageTester is RevertMessage {

    event Info(bytes data);

    function testCall(address target, bytes memory data) public {
        bool success;
        bytes memory returnData;

        (success, returnData) = target.call(data);

        emitRevert(returnData);
    }

    function testCallNoRevert(address target, bytes memory data) public {
        bool success;
        bytes memory returnData;

        (success, returnData) = target.call(data);
        emit Info(returnData);
    }
}
