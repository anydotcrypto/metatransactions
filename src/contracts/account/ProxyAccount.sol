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
        address signer =  ECDSA.recover(ECDSA.toEthSignedMessageHash(keccak256(signedData)), _signature);
        require(owner == signer, "Owner did not sign this meta-transaction.");

        // Reverts on fail
        verifyReplayProtection(_replayProtection, _replayProtectionType, owner);
    }
    
    /**
     * We check the signature has authorised the call before executing it.
     * @param _metaTx A single meta-transaction that includes to, value and data
     * @param _replayProtection Replay protection
     * @param _replayProtectionType Address of external replay protection
     * @param _signature Signature from signer
     */
    function forward(
        MetaTx calldata _metaTx,
        bytes calldata _replayProtection,
        ReplayProtectionType _replayProtectionType,
        bytes calldata _signature) external returns (bool, bytes memory) {

        // Verify the signer's signature 
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

        // Verify the signer's signature 
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