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
     * Each signer has a contract account (signers address => contract address).
     * We check the signer has authorised the target contract and function call. Then, we pass it to the
     * signer's contract account to perform the final execution (to help us bypass msg.sender problem).
     * @param _metaTx A single meta-transaction that includes to, value and data
     * @param _replayProtectionAuthority Identify the Replay protection, default is address(0)
     * @param _signature Signature from signer
     */
    function forward(
        MetaTx memory _metaTx,
        bytes memory _replayProtection,
        address _replayProtectionAuthority,
        bytes memory _signature)  public returns(bool, bytes memory){

        bytes memory encodedData = abi.encode(CallType.CALL, _metaTx.to, _metaTx.data);

        // // Reverts if fails.
        address signer = verify(encodedData, _replayProtection, _replayProtectionAuthority, _signature);

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
     * @param _replayProtectionAuthority Address of external replay protection
     * @param _signature Signature from signer
     */
    function batch(RevertableMetaTx[] memory _metaTxList,
        bytes memory _replayProtection,
        address _replayProtectionAuthority,
        bytes memory _signature) public {
        bytes memory encodedData = abi.encode(CallType.BATCH, _metaTxList);

        // Reverts if fails.
        address signer = verify(encodedData, _replayProtection, _replayProtectionAuthority, _signature);

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
