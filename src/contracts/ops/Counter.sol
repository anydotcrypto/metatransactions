pragma solidity 0.6.2;

contract Counter {

    uint public c;

    function increment() public {
        c = c + 1;
    }

}