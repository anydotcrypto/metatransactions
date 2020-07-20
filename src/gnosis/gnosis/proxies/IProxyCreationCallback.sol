pragma solidity ^0.5.3;
import "./GnosisProxy.sol";

interface IProxyCreationCallback {
    function proxyCreated(
        GnosisProxy proxy,
        address _mastercopy,
        bytes calldata initializer,
        uint256 saltNonce
    ) external;
}
