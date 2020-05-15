pragma solidity 0.6.2;

contract Echo {

    event Broadcast(string _message);

    function sendMessage(string memory _message) public {
        emit Broadcast(_message);
    }
}