pragma solidity 0.6.2;
pragma experimental ABIEncoderV2;

// A delegate deployer that reverts upon failure
// and emits the address if successful.
// @author Patrick McCorry
contract DelegateDeployer {

    event Deployed(address _contract);

    /// Note: This function is intended for DELEGATECALL.
    /// If you use CALL instead of DELEGATECALL, then:
    /// - constructor cannot use msg.sender (pass owner as constructor or use init())
    /// - ensure msg.value == _value.
    /// @dev Deploys a contract via CREATE2.
    /// @param _initCode Bytecode for deployment
    /// @param _value Specify coins to deploy with.
    /// @param _salt Hash of extra data.
    function deploy(bytes memory _initCode, uint _value, bytes32 _salt) public payable
    {
        address addr;

        assembly {
            addr := create2(_value, add(_initCode, 0x20), mload(_initCode), _salt)
        }

        require(addr != address(0), "CREATE2 failed to deploy.");
        emit Deployed(addr);
    }
}