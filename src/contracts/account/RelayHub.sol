pragma solidity 0.6.2;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/utils/Create2.sol";
import "./ReplayProtection.sol";
import "./ContractCall.sol";

/**
 * A minimal relay hub contract.
 * Verifies the signer's signature and replay protection before forwarding calldata to the target.
 * Delegates nonce verification to another contract.
 * Note it does NOT support delegatecall to avoid memory corruption problems.
 */
contract RelayHub is ReplayProtection, ContractCall {

    event Deployed(address signer, address addr);

    struct MetaTx {
        address target;
        bytes callData;
    }

    struct RevertableMetaTx {
        address target;
        bytes callData;
        bool revertOnFail;
    }

     /**
     * Each signer has a contract account (signers address => contract address).
     * We check the signer has authorised the target contract and function call. Then, we pass it to the
     * signer's contract account to perform the final execution (to help us bypass msg.sender problem).
     * @param _metaTx A single meta-transaction that includes target, value and calldata
     * @param _replayProtectionAuthority Identify the Replay protection, default is address(0)
     * @param _signer Signer's address
     * @param _signature Signature from signer
     */
    function forward(
        MetaTx memory _metaTx,
        bytes memory _replayProtection,
        address _replayProtectionAuthority,
        address _signer,
        bytes memory _signature) public {

        bytes memory encodedCallData = abi.encode(CallType.CALL, _metaTx.target, _metaTx.callData);

        // // Reverts if fails.
        require(_signer == verify(encodedCallData, _replayProtection, _replayProtectionAuthority, _signature),
        "Signer did not sign this meta-transaction.");

        // Does not revert. Lets us save the replay protection if it fails.
        forwardCall(_metaTx.target, 0, abi.encodePacked(_metaTx.callData, _signer));
    }

    /**
     * A batch of meta-transactions or meta-deployments.
     * One replay-protection check covers all transactions.
     * @param _metaTxList A list of revertable meta-transaction that includes target, value and calldata
     * @param _replayProtection Replay protection
     * @param _replayProtectionAuthority Address of external replay protection
     * @param _signer Signer
     * @param _signature Signature from signer
     */
    function batch(RevertableMetaTx[] memory _metaTxList,
        bytes memory _replayProtection,
        address _replayProtectionAuthority,
        address _signer,
        bytes memory _signature) public {
        bytes memory encodedData = abi.encode(CallType.BATCH, _metaTxList);

        // Reverts if fails.
        require(_signer == verify(encodedData, _replayProtection, _replayProtectionAuthority, _signature), "Owner did not sign this meta-transaction.");

        // Go through each revertable meta transaction and/or meta-deployment.
        for(uint i=0; i<_metaTxList.length; i++) {

            // Nope, let's execute the call!
            bool success = forwardCall(_metaTxList[i].target, 0, abi.encodePacked(_metaTxList[i].callData, _signer));

            if(_metaTxList[i].revertOnFail) {
                require(success, "Meta-transaction failed");
            }
        }
    }
}
