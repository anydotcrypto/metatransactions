pragma solidity 0.6.2;

contract Counter {
    uint256 public c;
    address public lastSentBy;

    function increment() public {
        c = c + 1;
        lastSentBy = msg.sender;
    }
}
