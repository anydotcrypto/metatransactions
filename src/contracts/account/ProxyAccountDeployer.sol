pragma solidity 0.6.2;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/utils/Create2.sol";
import "./ReplayProtection.sol";

/**
 * We deploy a new contract to bypass the msg.sender problem.
 */
contract ProxyAccount is ReplayProtection {

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
        bytes memory encodedData = abi.encode(_target, _value, _callData);

        // // Reverts if fails.
        require(owner == verify(encodedData, _replayProtection, _replayProtectionAuthority, _signature), "Owner did not sign this meta-transaction.");
        forwardCall(_target, _value, _callData);
    }

    /** 
     * Executes the call and extracts the revert message if it fails. 
     * @param _target Target contract
     * @param _value Quantity of eth in account contract to send to target
     * @param _callData Function name plus arguments
     */
    function forwardCall(address _target, uint _value, bytes memory _callData) internal returns(bool) {
        (bool success, bytes memory revertReason) = _target.call.value(_value)(abi.encodePacked(_callData));

        if(!success) {
            emit Revert(_getRevertMsg(revertReason));
        }

        return success;
    }

    /**
     * User deploys a contract in a deterministic manner.
     * It re-uses the replay protection to authorise deployment as part of the salt.
     * @param _initCode Initialisation code for contract
     * @param _replayProtection Encoded replay protection
     * @param _replayProtectionAuthority Identify the Replay protection, default is address(0)
     * @param _signature Signature from signer
     */
    function deployContract(
        bytes memory _initCode,
        bytes memory _replayProtection,
        address _replayProtectionAuthority,
        bytes memory _signature) public {

        // Confirm the user wants to deploy the smart contract
        require(owner == verify(_initCode, _replayProtection, _replayProtectionAuthority, _signature), "Owner of proxy account must authorise deploying contract");
        deploy(_initCode, _replayProtection);
 
    }

    /**
     * An INTERNAL function for CREATE2 
     * Required to ensure only the signer can deploy a contract at this address
     * (e.g. no one can front-run it with another CREATE2 deployer) 
     * @param _initCode Initialisation code for contract
     * @param _replayProtection Encoded replay protection
     */
    function deploy(bytes memory _initCode, bytes memory _replayProtection) internal {
        // We can just abuse the replay protection as the salt :)
        // Reverts on failure. No point to emit Revert().
        address deployed = Create2.deploy(keccak256(abi.encode(owner, _replayProtection)), _initCode);
        emit Deployed(owner, deployed);
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
        bytes memory _replayProtection,
        address _replayProtectionAuthority,
        bytes memory _signature) public {

        require(_target.length == _value.length && _value.length == _callData.length && _callData.length == _revertOnFail.length, "Target, value. calldata & revertOnFail must have the same length");
        bytes memory encodedData = abi.encode(_target, _value, _callData, _revertOnFail);

        // Reverts if fails.
        require(owner == verify(encodedData, _replayProtection, _replayProtectionAuthority, _signature), "Owner did not sign this meta-transaction.");

        // Go through each revertable meta transaction and/or meta-deployment.
        for(uint i=0; i<_target.length; i++) {

            // Are we deploying a contract? 
            if(_target[i] == address(0)) {

                // Note: Replay protection is re-used for as the salt multiple deployments
                // This is OK as the initCode is different. If it is the same, it reverts. 
                deploy(_callData[i], _replayProtection);
            } else {

                // Nope, let's execute the call!
                bool success = forwardCall(_target[i], _value[i], _callData[i]);

                // Should we fail on revert?
                if(_revertOnFail[i]) {
                    require(success, "Transaction destined for " + _target[i] + " reverted.");  
                }
        
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
