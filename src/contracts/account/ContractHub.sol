pragma solidity 0.6.2;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/utils/Create2.sol";
import "./ReplayProtection.sol";

/**
 * We deploy a new contract to bypass the msg.sender problem.
 */
contract ContractAccount {

    address relayHub;

    /**
     * Due to create clone, we need to use an init() method.
     */
    function init() public {
        require(relayHub == address(0), "Relay hub is already set");
        relayHub = msg.sender;
    }

    /**
     * Checks the command was received by the relay hub before executing target contract.
     * @param target Target contract
     * @param data Function call and data
     */
    function acceptCommand(address target, uint value, bytes memory data) public returns(bool) {
        require(msg.sender == relayHub, "Only RelayHub can run acceptCommand()");
        (bool success,) = target.call.value(value)(abi.encodePacked(data));
        return success;
    }
    
    /**
     * Receives ETH
     */
    receive() external payable {}
}


/**
 * A minimal relay hub contract.
 * Verifies the signer's signature and replay protection before forwarding calldata to the target.
 * Delegates nonce verification to another contract.
 */
contract ContractHub is ReplayProtection {

    enum MsgSenderType { CONTRACT, APPEND }
    mapping(address => address payable) public accounts;
    address payable public baseAccount;
    event ContractDeployed(address indexed addr);

    /**
     * Creates base Account for contracts
     */
    constructor() public {
        baseAccount = address(new ContractAccount());
        ContractAccount(baseAccount).init();
    }

    /**
     * User can sign a message to authorise creating an account.
     * There is only "one type" of account - does not really matter if signer authorised it.
     * @param _signer User's signing key
     */
    function createContractAccount(address _signer) public {
        require(accounts[_signer] == address(0), "Cannot install more than one account per signer");
        bytes32 salt = keccak256(abi.encodePacked(_signer));
        address payable clone = createClone(salt);
        accounts[_signer] = clone;
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

        // Initialize it to set msg.sender as the owner
        ContractAccount(result).init();
        return result;
    }

    /**
     * @dev Returns the address where a contract will be stored if deployed via {deploy}. Any change in the
     * `bytecodeHash` or `salt` will result in a new destination address.
     */
    function computeAddress(bytes32 salt, bytes32 bytecodeHash) public view returns (address) {
        bytes32 _data = keccak256(
            abi.encodePacked(bytes1(0xff), address(this), salt, bytecodeHash)
        );
        return address(bytes20(_data << 96));
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
        address signer = verify(_initCode, _replayProtection, _replayProtectionAuthority, _signature);

        // We can just abuse the replay protection as the salt :)
        address deployed = Create2.deploy(keccak256(abi.encode(signer, _replayProtection)), _initCode);

        emit ContractDeployed(deployed);
    }

     /**
     * Each signer has a contract account (signers address => contract address).
     * We check the signer has authorised the target contract and function call. Then, we pass it to the
     * signer's contract account to perform the final execution (to help us bypass msg.sender problem).
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

        // Assumes that ContractHub is ReplayProtection. 
        bytes memory encodedData = abi.encode(_target, _value, _callData);

        // // Reverts if fails.
        address signer = verify(encodedData, _replayProtection, _replayProtectionAuthority, _signature);

        // TODO: Can we deterministically compute it and check storage?
        // That way we don't need to keep a large mapping around.
        // Not sure how to do it with funky clone factory
        if(accounts[signer] == address(0)) {
            createContractAccount(signer);
        }

        // No need to check _target account since it will jump into the signer's contract account first.
        // e.g. we can never perform a .call() from ContractHub directly.
        bool success = ContractAccount(accounts[signer]).acceptCommand(_target, _value, _callData);
        require(success, "Forwarding call failed.");
    }

}
