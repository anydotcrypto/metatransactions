pragma solidity 0.6.2;

contract Echo {

    event Broadcast(string _message);

    string public lastMessage;
    function sendMessage(string memory _message) public {
        lastMessage = _message;
        emit Broadcast(_message);
    }

}