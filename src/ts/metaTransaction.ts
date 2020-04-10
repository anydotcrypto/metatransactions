import { keccak256, arrayify, defaultAbiCoder, BigNumber } from "ethers/utils";
import { Wallet } from "ethers/wallet";
import { Contract } from "ethers";

/**
 * Currently identitical to relayHub.ts
 * Ideally, a developer can provide the target contract, value and calldata to the library.
 * Library returns the meta-transaction with valid replay protection.
 * Other services like any.sender, GSN, Authereum, etc can build upon it
 * for their own services.
 */

const nonceTracker = new Map<string, BigNumber>();
let hubContract: Contract; // Default value for mainnet

export function updateHub(hub: Contract) {
  hubContract = hub;
}

export interface ForwardParams {
  relayHub: string;
  signer: string;
  target: string;
  value: string;
  data: string;
  replayProtection: string;
  replayProtectionAuthority: string;
  chainId: number;
  signature: string;
}

/**
 * Fetch latest nonce we can use for the replay protection. It is either taken
 * from the contract directoy or what we have kept in memory.
 * We assume that a transaction WILL be broadcast if this function is called.
 * @param signer Signer's address
 * @param contractAddress Relay contract's address
 * @param index Concurrency index for reply protection
 */
async function getLatestMultiNonce(
  signerAddress: string,
  hubContract: Contract,
  index: BigNumber
) {
  const id = keccak256(
    defaultAbiCoder.encode(["address", "uint"], [signerAddress, index])
  );

  const tracked = nonceTracker.get(id);

  // Fetch latest number found.
  if (tracked) {
    // Increment it in our store, so we know to serve it.
    nonceTracker.set(id, tracked.add(1));
    return tracked;
  }

  // In the ReplayProtection.sol, we use latestNonce == storedNonce then continue.
  let latestNonce: BigNumber = await hubContract.nonceStore(id);

  // Increment it our store, so we know to serve it.
  nonceTracker.set(id, latestNonce.add(1));
  return latestNonce;
}

export async function getEncodedMultiNonce(
  signerAddress: string,
  hubContract: Contract,
  index: BigNumber
) {
  const latestNonce = await getLatestMultiNonce(
    signerAddress,
    hubContract,
    index
  );
  return defaultAbiCoder.encode(["uint", "uint"], [index, latestNonce]);
}

export function getEncodedCallData(
  target: string,
  value: BigNumber,
  callData: string
) {
  return defaultAbiCoder.encode(
    ["address", "uint", "bytes"],
    [target, value, callData]
  );
}
export function getEncodedMetaTransactionToSign(
  encodedCallData: string,
  encodedReplayProtection: string,
  replayProtectionAuthority: string,
  hubContract: string
) {
  // We expect encoded call data to include target contract address, the value, and the callData.
  // Message signed: H(encodedCallData, encodedReplayProtection, replay protection authority, relay contract address, chainid);
  return defaultAbiCoder.encode(
    ["bytes", "bytes", "address", "address", "uint"],
    [
      encodedCallData,
      encodedReplayProtection,
      replayProtectionAuthority,
      hubContract,
      0
    ]
  );
}

/**
 * Easy method for signing a meta-transaction. Takes care of replay protection.
 * Note it is using replace-by-nonce, and not multinonce as the "index" is always 0.
 * @param relayHubAddress Relay or Contract Hub address
 * @param signer Signer's wallet
 * @param target Target contract address
 * @param value Value to send
 * @param msgSenderCall Encoded calldata
 */
export async function signMetaTransaction(
  signer: Wallet,
  target: string,
  value: BigNumber,
  callData: string
) {
  // Encode expected data
  const encodedReplayProtection = await getEncodedMultiNonce(
    signer.address,
    hubContract,
    new BigNumber("0")
  );
  const encodedCallData = getEncodedCallData(target, value, callData);
  const encodedData = getEncodedMetaTransactionToSign(
    encodedCallData,
    encodedReplayProtection,
    "0x0000000000000000000000000000000000000000",
    hubContract.address
  );

  const signature = await signer.signMessage(arrayify(keccak256(encodedData)));
  const params: ForwardParams = {
    relayHub: hubContract.address,
    signer: signer.address,
    target: target,
    value: value.toString(),
    data: callData,
    replayProtection: encodedReplayProtection,
    replayProtectionAuthority: "0x0000000000000000000000000000000000000000",
    chainId: 0,
    signature: signature
  };

  return params;
}

/**
 * Easy method for signing a meta-transaction. Takes care of replay protection.
 * Note it is using replace-by-nonce, and not multinonce as the "index" is always 0.
 * @param relayHubAddress Relay or Contract Hub address
 * @param signer Signer's wallet
 * @param target Target contract address
 * @param value Value to send
 * @param msgSenderCall Encoded calldata
 */
export async function signMetaDeployment(signer: Wallet, initCode: string) {
  // Encode expected data
  const encodedReplayProtection = await getEncodedMultiNonce(
    signer.address,
    hubContract,
    new BigNumber("0")
  );
  const encodedData = getEncodedMetaTransactionToSign(
    initCode,
    encodedReplayProtection,
    "0x0000000000000000000000000000000000000000",
    hubContract.address
  );

  const signature = await signer.signMessage(arrayify(keccak256(encodedData)));
  const params: ForwardParams = {
    relayHub: hubContract.address,
    signer: signer.address,
    target: "0x0000000000000000000000000000000000000000",
    value: "0",
    data: initCode,
    replayProtection: encodedReplayProtection,
    replayProtectionAuthority: "0x0000000000000000000000000000000000000000",
    chainId: 0,
    signature: signature
  };

  return params;
}
