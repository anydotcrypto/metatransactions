pragma solidity 0.6.2;

import "../account/MsgSender.sol";

contract MsgSenderExample is MsgSender {

    event WhoIsSender(address signer);

    constructor(address _relayHub) public {
        relayHub = _relayHub;
    }

    function test() public {
        address sender = _msgSender();
        emit WhoIsSender(sender);
    }

    function willRevert() public {
        require(1 == 2, "Will always revert");
    }

}