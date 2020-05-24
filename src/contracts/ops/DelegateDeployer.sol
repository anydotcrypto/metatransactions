pragma solidity 0.6.2;
pragma experimental ABIEncoderV2;

// A delegate deployer that reverts upon failure
// and emits the address if successful.
// @author Patrick McCorry
contract DelegateDeployer {

    event Deployed(address _contract);

    /// Note: This function is intended for DELEGATECALL.
    /// If used by call:
    /// - value === msg.value, otherwise it may lose coins.
    /// - constructor cannot use msg.sender (pass owner as constructor or use init())
    /// @dev Deploys a contract via CREATE2.
    /// @param _initCode Bytecode for deployment
    /// @param _value Specify coins to deploy with. (Required for DELEGATECALL)
    /// @param _hashData Extra data for the salt. Salt is H(H(_extraData) | msg.sender)
    function deploy(bytes memory _initCode, uint _value, bytes32 _hashData) public payable
    {
        bytes32 salt = keccak256(abi.encodePacked(_hashData));
        address addr;

        assembly {
            addr := create2(_value, add(_initCode, 0x20), mload(_initCode), salt)
        }

        require(addr != address(0), "CREATE2 failed to deploy.");
        emit Deployed(addr);
    }
}