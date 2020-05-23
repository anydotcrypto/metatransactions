pragma solidity 0.6.2;
pragma experimental ABIEncoderV2;

import "./ReplayProtection.sol";
import "./ContractCall.sol";

/**
 * We deploy a new contract to bypass the msg.sender problem.
 */
contract ProxyAccount is ReplayProtection, ContractCall {

    address public owner;
    event Deployed(address owner, address addr);
    event Revert(string reason);

    /**
     * Due to create clone, we need to use an init() method.
     */
    function init(address _owner) public {
        require(owner == address(0), "Owner is already set");
        owner = _owner;
    }

    /**
     * We check the signature has authorised the call before executing it.
     * @param _target Target contract
     * @param _value Quantity of eth in account contract to send to target
     * @param _callData Function name plus arguments
     * @param _replayProtection Replay protection
     * @param _replayProtectionAuthority Address of external replay protection
     * @param _signature Signature from signer
     */
    function forward(
        address _target,
        uint _value, 
        bytes memory _callData,
        bytes memory _replayProtection,
        address _replayProtectionAuthority,
        bytes memory _signature) public {

        // Assumes that ProxyAccountDeployer is ReplayProtection. 
        bytes memory encodedData = abi.encode(CallType.CALL, _target, _value, _callData);

        // // Reverts if fails.
        require(owner == verify(encodedData, _replayProtection, _replayProtectionAuthority, _signature), "Owner did not sign this meta-transaction.");
        call(_target, _value, _callData); // We do not want this to revert. Save the replay protection 
    }

    /**
     * We check the signature has authorised the call before executing it.
     * WARNING: Be VERY VERY VERY cautious of contracts that can modify / store state. 
     * Intended use is when msg.sender is required for code execution (e.g. CREATE2). 
     * @param _target Target contract
     * @param _value Quantity of eth in account contract to send to target
     * @param _callData Function name plus arguments
     * @param _replayProtection Replay protection
     * @param _replayProtectionAuthority Address of external replay protection
     * @param _signature Signature from signer
     */
    function delegate(
        address _target,
        uint _value, 
        bytes memory _callData,
        bytes memory _replayProtection,
        address _replayProtectionAuthority,
        bytes memory _signature) public {

        // Assumes that ProxyAccountDeployer is ReplayProtection. 
        bytes memory encodedData = abi.encode(CallType.DELEGATE, _target, _value, _callData);

        // // Reverts if fails.
        require(owner == verify(encodedData, _replayProtection, _replayProtectionAuthority, _signature), "Owner did not sign this meta-transaction.");
        delegate(_target, _callData); // We do not want this to revert. Save the replay protection 
    }

    /**
     * A batch of meta-transactions or meta-deployments.
     * One replay-protection check covers all transactions. 
     * @param _target List of target contract (Set to address(0) for a meta-deployment)
     * @param _value List of wei to send in each transaction
     * @param _callData List of function names + data for each transaction.
     * @param _replayProtection Replay protection
     * @param _replayProtectionAuthority Address of external replay protection
     * @param _signature Signature from signer
     */
    function batch(address[] memory _target,
        uint[] memory _value, 
        bytes[] memory _callData,
        bool[] memory _revertOnFail,
        CallType[] memory _callType,
        bytes memory _replayProtection,
        address _replayProtectionAuthority,
        bytes memory _signature) public {

        require(_target.length == _value.length && _value.length == _callData.length && _callData.length == _revertOnFail.length && _revertOnFail.length == _callType.length, "Target, value, calldata, revertOnFail & callType must have the same length");
        bytes memory encodedData = abi.encode(CallType.BATCH, _target, _value, _callData, _revertOnFail, _callType);

        // Reverts if fails.
        require(owner == verify(encodedData, _replayProtection, _replayProtectionAuthority, _signature), "Owner did not sign this meta-transaction.");

        // Go through each revertable meta transaction and/or meta-deployment.
        for(uint i=0; i<_target.length; i++) {

            bool success = false; 

            if(_callType[i] == CallType.CALL) {
                success = call(_target[i], _value[i], _callData[i]);
            } else if(_callType[i] == CallType.DELEGATE) {
                success = delegate(_target[i], _callData[i]);
            }

            // Should we fail on revert?
            if(_revertOnFail[i]) {
                require(success, "Transaction reverted.");  
            }
        }
    }

    /**
     * Receives ETH
     */
    receive() external payable {}
}


/**
 * Responsible for deploying new proxy accounts via CREATE2
 * Every user has their own proxy account.
 */
contract ProxyAccountDeployer {

    address payable public baseAccount;

    /**
     * Creates base Account for contracts
     */
    constructor() public {
        baseAccount = address(new ProxyAccount{ salt : keccak256("v0.1.0|BASE_ACCOUNT") }());
        ProxyAccount(baseAccount).init(address(this));
    }

    /**
     * User can sign a message to authorise creating an account.
     * There is only "one type" of account - does not really matter if signer authorised it.
     * @param _signer User's signing key
     */
    function createProxyAccount(address _signer) public {
        bytes32 salt = keccak256(abi.encodePacked(_signer));
        address payable clone = createClone(salt);
        ProxyAccount(clone).init(_signer);
    }

    /**
     * Modified https://github.com/optionality/clone-factory/blob/master/contracts/CloneFactory.sol#L30
     * to support Create2.
     * @param _salt Salt for CREATE2
     */
    function createClone(bytes32 _salt) internal returns (address payable result) {
        bytes20 targetBytes = bytes20(baseAccount);
        assembly {
            let clone := mload(0x40)
            mstore(clone, 0x3d602d80600a3d3981f3363d3d373d3d3d363d73000000000000000000000000)
            mstore(add(clone, 0x14), targetBytes)
            mstore(add(clone, 0x28), 0x5af43d82803e903d91602b57fd5bf30000000000000000000000000000000000)
            result := create2(0, clone, 0x37, _salt)
        }
        return result;
    }

}
