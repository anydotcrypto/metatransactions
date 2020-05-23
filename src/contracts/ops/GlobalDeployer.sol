pragma solidity 0.6.2;
pragma experimental ABIEncoderV2;

// Send a batch of transaction.
// @author Patrick McCorry

contract GlobalDeployer {

    event Deployed(address _contract);

    /// @dev Deploys a contract via CREATE2.
    /// @param _initCode Bytecode for deployment
    /// @param _extraData Extra data for the salt. Salt is H(_extraData | msg.sender)
    function deploy(bytes memory _initCode, bytes32 _extraData) public payable
    {
        bytes32 salt = keccak256(abi.encodePacked(_extraData, msg.sender));
        address addr;
        uint value = msg.value;
        assembly {
            addr := create2(value, add(_initCode, 0x20), mload(_initCode), salt)
        }

        require(addr != address(0), "CREATE2 failed to deploy.");
        emit Deployed(addr);
    }
}