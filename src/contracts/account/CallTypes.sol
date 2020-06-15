pragma solidity 0.6.2;
pragma experimental ABIEncoderV2;

/**
 * Common CALL functionality for the proxy contract and relayhub
 */
contract CallTypes {

    enum CallType {CALL, DELEGATE, BATCH}
}
