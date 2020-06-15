pragma solidity 0.6.2;
pragma experimental ABIEncoderV2;


import "../account/RevertMessage.sol";
import "../account/CallTypes.sol";

// Send a batch of transaction.
// @author Patrick McCorry

contract BatchInternal is CallTypes, RevertMessage {

    struct RevertableMetaTx {
        address to;
        uint value;
        bytes data;
        bool revertOnFail;
        CallType callType;
    }


    /// @dev Sends multiple transactions and reverts all if one fails.
    /// @param _metaTxList A list of revertable meta-transactions
    function batchInternal(RevertableMetaTx[] memory _metaTxList) internal {

        for(uint i=0; i<_metaTxList.length; i++) {
            bool success;
            bytes memory returnedData;

            require(_metaTxList[i].callType == CallType.CALL || _metaTxList[i].callType == CallType.DELEGATE, "CallType not set.");
            
            if(_metaTxList[i].callType == CallType.CALL) {
                (success, returnedData) = _metaTxList[i].to.call{value: _metaTxList[i].value}(abi.encodePacked(_metaTxList[i].data));
            }

            if(_metaTxList[i].callType == CallType.DELEGATE) {
                (success, returnedData) = _metaTxList[i].to.delegatecall(abi.encodePacked(_metaTxList[i].data));

            }

            if(!success) {
                emitRevert(returnedData);
            }

            // Should we fail on revert?
            if(_metaTxList[i].revertOnFail) {
                require(success, "Transaction reverted.");
            }
        }

    }
}