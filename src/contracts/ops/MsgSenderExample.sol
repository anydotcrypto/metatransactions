pragma solidity 0.6.2;

import "../account/MsgSender.sol";

contract MsgSenderExample is MsgSender {

    mapping(address => bool) public sentTest;
    event WhoIsSender(address signer);

    constructor(address _relayHub) public payable {
        relayHub = _relayHub;
    }

    function test() public returns (string memory) {
        address sender = _msgSender();
        sentTest[sender] = true;
        emit WhoIsSender(sender);
        return "hello";
    }

    function willRevert() public pure {
        require(1 == 2, "Will always revert");
    }

    function willRevertLongMessage() public pure {
        require(1 == 2, "This is a really long revert message to make sure we can catch it. There are no hidden quirks by solidity.");
    }

    function willRevertNoMessage() public pure {
        require(1 == 2);
    }

}