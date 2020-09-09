pragma solidity 0.6.2;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/utils/Create2.sol";
import "./ReplayProtection.sol";
import "./CallTypes.sol";
import "./RevertMessage.sol";

/**
 * A minimal relay hub contract.
 * Verifies the signer's signature and replay protection before forwarding data to the target contract.
 * Delegates nonce verification to another contract.
 * Note it does NOT support delegatecall to avoid memory corruption problems.
 */
contract RelayHub is ReplayProtection, CallTypes, RevertMessage {

    struct MetaTx {
        address to;
        bytes data;
    }

    struct RevertableMetaTx {
        address to;
        bytes data;
        bool revertOnFail;
    }

    /**
     * Authenticates the signer. Reverts on fail. 
     * @param _callData An encoded list of meta-transactions (can be 1)
     * @param _replayProtection Replay protection data
     * @param _replayProtectionType Multinonce or Bitflip
     * @param _signature Signature from signer
     */
    function authenticateSigner(
        bytes memory _callData,
        bytes memory _replayProtection,
        ReplayProtectionType _replayProtectionType,
        bytes memory _signature) internal returns(address) {
            
        // Extract signer's address.
        bytes memory signedData = abi.encode(_callData, _replayProtection, _replayProtectionType, address(this), getChainID());
        bytes32 txid = keccak256(signedData);
        address signer = ECDSA.recover(ECDSA.toEthSignedMessageHash(txid), _signature);
        
        // We do not check if signer == supplied signer. Only necessary
        // in the wallet contract as it has 1 owner. 
        
        // Reverts if fails.
        verifyReplayProtection(_replayProtection, _replayProtectionType, signer, txid);

        return signer;
    }

     /**
     * Each signer has a contract account (signers address => contract address).
     * We check the signer has authorised the target contract and function call. Then, we pass it to the
     * signer's contract account to perform the final execution (to help us bypass msg.sender problem).
     * @param _metaTx A single meta-transaction that includes to, value and data
     * @param _replayProtection Replay protection data
     * @param _replayProtectionType Multinonce or Bitflip
     * @param _signature Signature from signer
     */
    function forward(
        MetaTx memory _metaTx,
        bytes memory _replayProtection,
        ReplayProtectionType _replayProtectionType,
        bytes memory _signature)  public returns(bool, bytes memory){

        // Authenticate the signer
        bytes memory callData = abi.encode(CallType.CALL, _metaTx.to, _metaTx.data);

        // Revert on fail.
        address signer = authenticateSigner(callData, _replayProtection, _replayProtectionType, _signature);

        // Does not revert. Lets us save the replay protection if it fails.
        (bool success, bytes memory returnData) = _metaTx.to.call(abi.encodePacked(_metaTx.data, signer));

        if(!success) {
            emitRevert(returnData);
        }

        return (success, returnData);
    }

    /**
     * A batch of meta-transactions or meta-deployments.
     * One replay-protection check covers all transactions.
     * @param _metaTxList A list of revertable meta-transaction that includes to, value and data
     * @param _replayProtection Replay protection
     * @param _replayProtectionType Address of external replay protection
     * @param _signature Signature from signer
     */
    function batch(RevertableMetaTx[] memory _metaTxList,
        bytes memory _replayProtection,
        ReplayProtectionType _replayProtectionType,
        bytes memory _signature) public {

        // Prepare the encoded data
        bytes memory callData = abi.encode(CallType.BATCH, _metaTxList);

        // Authenticate the signer
        address signer = authenticateSigner(callData, _replayProtection, _replayProtectionType, _signature);

        // Go through each revertable meta transaction and/or meta-deployment.
        for(uint i=0; i<_metaTxList.length; i++) {

            // Nope, let's execute the call!
            (bool success, bytes memory returnData) = _metaTxList[i].to.call(abi.encodePacked(_metaTxList[i].data, signer));

            if(!success) {
                emitRevert(returnData);
            }

            if(_metaTxList[i].revertOnFail) {
                require(success, "Meta-transaction failed");
            }
        }
    }
}
