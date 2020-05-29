pragma solidity 0.6.2;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/cryptography/ECDSA.sol";

/**
 * Authenticates a single signer
 */
contract SingleSigner {

    address public owner;

    /// @dev Due to create clone, we need to use an init() method.
    function init(address _owner) public {
        require(owner == address(0), "Owner is already set");
        owner = _owner;
    }

    /// @dev Authenticates the user's signature
    /// @param _txid Hash of meta-tx
    /// @param _signature Signature of hash
    function authenticate(bytes32 _txid, bytes memory _signature) public view {
        address signer = ECDSA.recover(ECDSA.toEthSignedMessageHash(_txid), _signature);
        require(signer == owner, "Owner of the proxy account did not authorise the tx");
    }

    /// @dev Return owner.
    function getOwner() internal view returns (address) {
        return owner;
    }

}
