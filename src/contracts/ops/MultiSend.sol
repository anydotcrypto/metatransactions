pragma solidity 0.6.2;
pragma experimental ABIEncoderV2;


import "./BatchInternal.sol";

// Send a batch of transaction.
// @author Patrick McCorry

contract MultiSend is BatchInternal {

    /// @dev Sends multiple transactions and reverts all if one fails.
    /// @param _metaTxList A list of revertable meta-transactions
    function batch(RevertableMetaTx[] memory _metaTxList) public {

        batchInternal(_metaTxList);
    }
}