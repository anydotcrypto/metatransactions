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

     /**
     * Each signer has a contract account (signers address => contract address).
     * We check the signer has authorised the target contract and function call. Then, we pass it to the
     * signer's contract account to perform the final execution (to help us bypass msg.sender problem).
     * @param _target Target contract
     * @param _callData Function name plus arguments
     * @param _replayProtection Replay protection (e.g. multinonce)
     * @param _replayProtectionAuthority Identify the Replay protection, default is address(0)
     * @param _signer Signer's address
     * @param _signature Signature from signer
     */
    function forward(
        address _target,
        bytes memory _callData,
        bytes memory _replayProtection,
        address _replayProtectionAuthority,
        address _signer,
        bytes memory _signature) public {

        bytes memory encodedCallData = abi.encode(CallType.CALL, _target, _callData);

        // // Reverts if fails.
        require(_signer == verify(encodedCallData, _replayProtection, _replayProtectionAuthority, _signature),
        "Signer did not sign this meta-transaction.");

        // Does not revert. Lets us save the replay protection if it fails.
        call(_target, 0, abi.encodePacked(_callData, _signer));
    }

    /**
     * A batch of meta-transactions or meta-deployments.
     * One replay-protection check covers all transactions.
     * @param _target List of target contract (Set to address(0) for a meta-deployment)
     * @param _callData List of function names + data for each transaction.
     * @param _replayProtection Replay protection
     * @param _replayProtectionAuthority Address of external replay protection
     * @param _signer Signer
     * @param _signature Signature from signer
     */
    function batch(address[] memory _target,
        bytes[] memory _callData,
        bool[] memory _revertOnFail,
        bytes memory _replayProtection,
        address _replayProtectionAuthority,
        address _signer,
        bytes memory _signature) public {

        require(_target.length == _callData.length && _callData.length == _revertOnFail.length, "Target, calldata & revertOnFail must have the same length");
        bytes memory encodedData = abi.encode(CallType.BATCH, _target,  _callData, _revertOnFail);

        // Reverts if fails.
        require(_signer == verify(encodedData, _replayProtection, _replayProtectionAuthority, _signature), "Owner did not sign this meta-transaction.");

        // Go through each revertable meta transaction and/or meta-deployment.
        for(uint i=0; i<_target.length; i++) {

            // Nope, let's execute the call!
            bool success = call(_target[i], 0, abi.encodePacked(_callData[i], _signer));

            if(_revertOnFail[i]) {
                require(success, "Meta-transaction failed");
            }
        }
    }
}
