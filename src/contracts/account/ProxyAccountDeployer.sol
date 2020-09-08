pragma solidity 0.6.2;
pragma experimental ABIEncoderV2;

import "./ReplayProtection.sol";
import "../ops/BatchInternal.sol";

/**
 * We deploy a new contract to bypass the msg.sender problem.
 */
contract ProxyAccount is ReplayProtection, BatchInternal {

    address public owner;

    struct MetaTx {
        address to;
        uint value;
        bytes data;
        CallType callType;
    }

    /**
     * Due to create clone, we need to use an init() method.
     */
    function init(address _owner) public {
        require(owner == address(0), "Owner is already set");
        owner = _owner;
    }
    
    /**
     * Authenticates the signer. Reverts on fail. 
     * @param _callData An encoded list of meta-transactions (can be 1)
     * @param _replayProtection Replay protection data
     * @param _replayProtectionType Multinonce or Bitflip
     * @param _signature Signature from signer
     */
    function authenticateSigner(bytes memory _callData,
        bytes memory _replayProtection,
        ReplayProtectionType _replayProtectionType,
        bytes memory _signature) internal {

        // Extract signer's address.
        bytes memory signedData = abi.encode(_callData, _replayProtection, _replayProtectionType, address(this), getChainID());
        bytes32 txid = keccak256(signedData);
        address signer =  ECDSA.recover(ECDSA.toEthSignedMessageHash(txid), _signature);
        require(owner == signer, "Owner did not sign this meta-transaction.");

        // Reverts on fail
        verify(_replayProtection, _replayProtectionType, owner, txid);

    }

    /**
     * We check the signature has authorised the call before executing it.
     * @param _metaTx A single meta-transaction that includes to, value and data
     * @param _replayProtection Replay protection
     * @param _replayProtectionType Address of external replay protection
     * @param _signature Signature from signer
     */
    function forward(
        MetaTx memory _metaTx,
        bytes memory _replayProtection,
        ReplayProtectionType _replayProtectionType,
        bytes memory _signature) public returns (bool, bytes memory) {

        // Assumes that ProxyAccountDeployer is ReplayProtection. 
        bytes memory callData = abi.encode(_metaTx.callType, _metaTx.to, _metaTx.value, _metaTx.data);

        // Reverts on fail
        authenticateSigner(callData, _replayProtection, _replayProtectionType, _signature);

        bool success;
        bytes memory returnData;

        if(_metaTx.callType == CallType.CALL) {
            (success, returnData) = _metaTx.to.call{value: _metaTx.value}(abi.encodePacked(_metaTx.data));
        } 
        
        // WARNING: Delegatecall can over-write storage in this contract.
        // Be VERY careful.
        if(_metaTx.callType == CallType.DELEGATE) {
            (success, returnData) = _metaTx.to.delegatecall(abi.encodePacked(_metaTx.data));
        } 

        if(!success) {
            emitRevert(returnData);
        }

        return (success, returnData);
    }

    /**
     * A batch of meta-transactions or meta-deployments.
     * One replay-protection check covers all transactions. 
     * Potentially reverts on fail.
     * @param _metaTxList List of revertable meta-transactions
     * @param _replayProtection Replay protection
     * @param _replayProtectionType Address of external replay protection
     * @param _signature Signature from signer
     */
    function batch(RevertableMetaTx[] memory _metaTxList,
        bytes memory _replayProtection,
        ReplayProtectionType _replayProtectionType,
        bytes memory _signature) public {

        bytes memory callData = abi.encode(CallType.BATCH, _metaTxList);

        // Reverts on fail
        authenticateSigner(callData, _replayProtection, _replayProtectionType, _signature);

        // Runs the batch function in MultiSend.
        // It supports CALL and DELEGATECALL.
        batchInternal(_metaTxList);
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
