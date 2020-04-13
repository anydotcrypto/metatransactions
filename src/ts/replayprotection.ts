import { BigNumber, keccak256, defaultAbiCoder } from "ethers/utils";
import { Contract } from "ethers";

export interface Nonces {
  index: BigNumber;
  latestNonce: BigNumber;
}

/**
 * Easy to implement replay protection authority.
 * It should be designed to work for multi-users
 * like in the RelayHub and single-users like in
 * the contract accounts.
 */
export abstract class ReplayProtectionAuthority {
  /**
   * On-chain contract address for the authority.
   */
  abstract getAddress(): string;

  /**
   * Return the encoded replay protection for this signer
   *
   * @param signerAddress Signer's address
   */
  abstract async getEncodedReplayProtection(
    signerAddress: string,
    hubContract: Contract
  ): Promise<string>;

  /**
   * We may need to access on-chain contract to fetch the starting
   * point for the replay protection. e.g. in replace-by-nonce,
   * you want to fetch the latest and only valid nonce (50).
   * @param signerAddress Signer's address
   * @param index Index in Nonce Store
   * @param hubContract Hub Contract
   */
  protected async accessNonceStore(
    signerAddress: string,
    index: BigNumber,
    hubContract: Contract
  ): Promise<BigNumber> {
    // In the ReplayProtection.sol, we use latestNonce == storedNonce then continue.
    // Onchain ID = H(signerAddress, index).
    const onchainId = keccak256(
      defaultAbiCoder.encode(["address", "uint"], [signerAddress, index])
    );

    return await hubContract.nonceStore(onchainId);
  }
}
