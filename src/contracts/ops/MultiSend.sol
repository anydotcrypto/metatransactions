pragma solidity 0.6.2;
pragma experimental ABIEncoderV2;


import "../account/ContractCall.sol";
// Send a batch of transaction.
// @author Patrick McCorry

contract MultiSend is ContractCall {

    struct RevertableMetaTx {
        address to;
        uint value;
        bytes data;
        bool revertOnFail;
        CallType callType;
    }


    /// @dev Sends multiple transactions and reverts all if one fails.
    /// @param _metaTxList A list of revertable meta-transactions
    function batch(RevertableMetaTx[] memory _metaTxList) public {

        for(uint i=0; i<_metaTxList.length; i++) {
            bool success = forwardCall(_metaTxList[i].to, _metaTxList[i].value, _metaTxList[i].data);

            // Should we fail on revert?
            if(_metaTxList[i].revertOnFail) {
                require(success, "Transaction reverted.");
            }
        }

    }
}