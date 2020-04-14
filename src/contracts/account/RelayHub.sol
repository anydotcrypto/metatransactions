pragma solidity 0.6.2;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/utils/Create2.sol";
import "./ReplayProtection.sol";

/**
 * A minimal relay hub contract.
 * Verifies the signer's signature and replay protection before forwarding calldata to the target.
 * Delegates nonce verification to another contract.
 */
contract RelayHub is ReplayProtection {

     event Deployed(address signer, address addr);

     /**
     * Each signer has a contract account (signers address => contract address).
     * We check the signer has authorised the target contract and function call. Then, we pass it to the
     * signer's contract account to perform the final execution (to help us bypass msg.sender problem).
     * @param _target Target contract
     * @param _value Quantity of eth in account contract to send to target
     * @param _callData Function name plus arguments
     * @param _replayProtection Replay protection (e.g. multinonce)
     * @param _replayProtectionAuthority Identify the Replay protection, default is address(0)
     * @param _signer Signer's address
     * @param _signature Signature from signer
     */
    function forward(
        address _target,
        uint _value, // only used for accounts
        bytes memory _callData,
        bytes memory _replayProtection,
        address _replayProtectionAuthority,
        address _signer,
        bytes memory _signature) public {

        bytes memory encodedCallData = abi.encode(_target, _value, _callData);

        // // Reverts if fails.
        require(_signer == verify(encodedCallData, _replayProtection, _replayProtectionAuthority, _signature),
        "Signer did not sign this meta-transaction.");

        // Check if the user wants to send command from their contract account or signer address
        (bool success,) = _target.call(abi.encodePacked(_callData, _signer));
        require(success, "Forwarding call failed.");
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
        address _signer,
        bytes memory _signature) public {

        // Confirm the user wants to deploy the smart contract
        require(_signer == verify(_initCode, _replayProtection, _replayProtectionAuthority, _signature),
        "Signer must aurhotise deploying contract");

        // We can just abuse the replay protection as the salt :)
        address deployed = Create2.deploy(keccak256(abi.encode(_signer, _replayProtection)), _initCode);

        emit Deployed(_signer, deployed);
    }


}
