import { BigNumber, keccak256, defaultAbiCoder } from "ethers/utils";
import { Contract, Wallet } from "ethers";
import { ReplayProtectionFactory } from "../typedContracts/ReplayProtectionFactory";

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
    signer: Wallet,
    contract: string
  ): Promise<string>;

  /**
   * We may need to access on-chain contract to fetch the starting
   * point for the replay protection. e.g. in replace-by-nonce,
   * you want to fetch the latest and only valid nonce (50).
   * @param signerAddress Signer's address
   * @param index Index in Nonce Store
   * @param contract Hub Contract
   */
  protected async accessNonceStore(
    signer: Wallet,
    index: BigNumber,
    contract: string
  ): Promise<BigNumber> {
    try {
      const replayProtection = new ReplayProtectionFactory(signer).attach(
        contract
      );
      // In the ReplayProtection.sol, we use latestNonce == storedNonce then continue.
      // Onchain ID = H(signerAddress, index).
      // Mostly benefits bitflip & multinonce.
      const onchainId = keccak256(
        defaultAbiCoder.encode(["address", "uint"], [signer.address, index])
      );

      return await replayProtection.nonceStore(onchainId);
    } catch (e) {
      // Contract is not deployed. Very likely a new user, so return the default index 0.
      return new BigNumber("0");
    }
  }
}
