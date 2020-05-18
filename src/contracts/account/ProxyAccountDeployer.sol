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
     * Each signer has a proxy account (signers address => contract address).
     * We check the signer has authorised the target contract and function call. Then, we pass it to the
     * signer's proxy account to perform the final execution (to help us bypass msg.sender problem).
     * @param _target Target contract
     * @param _value Quantity of eth in account contract to send to target
     * @param _callData Function name plus arguments
     * @param _replayProtection Replay protection (e.g. multinonce)
     * @param _replayProtectionAuthority Identify the Replay protection, default is address(0)
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

        (bool success, bytes memory revertReason) = _target.call.value(_value)(abi.encodePacked(_callData));

        if(!success) {
            assembly {revertReason := add(revertReason, 68)}
            // 4 bytes = sighash
            // 64 bytes = length of string
            // If we slice offchain, then we can verify the sighash
            // too. https://twitter.com/ricmoo/status/1262156359853920259
            // IF we slice onchain, then we lose that information.
            emit Revert(string(revertReason));
        }
    }

    /**
     * User deploys a contract in a deterministic manner.
     * It re-uses the replay protection to authorise deployment as part of the salt.
     * @param _initCode Initialisation code for contract
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

        // We can just abuse the replay protection as the salt :)
        address deployed = Create2.deploy(keccak256(abi.encode(owner, _replayProtection)), _initCode);

        emit Deployed(owner, deployed);
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
