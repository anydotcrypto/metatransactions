import { BigNumber, keccak256, defaultAbiCoder } from "ethers/utils";
import { Wallet } from "ethers";
import { ReplayProtectionFactory } from "../../typedContracts/ReplayProtectionFactory";

export interface Nonces {
  index: BigNumber;
  latestNonce: BigNumber;
}
/**
 * Common functionality for the replay protection authorities.
 */
export abstract class ReplayProtectionAuthority {
  /**
   * Replay protection is dedicated for a single user
   * @param signer Signer's wallet
   */
  constructor(
    protected readonly signer: Wallet,
    protected readonly forwarderAddress: string
  ) {}

  /**
   * On-chain contract address for the authority.
   */
  abstract getAddress(): string;

  /**
   * Fetch and encode the latest replay protection
   */
  abstract async getEncodedReplayProtection(): Promise<string>;

  /**
   * We may need to access on-chain contract to fetch the starting
   * point for the replay protection. e.g. in replace-by-nonce,
   * you want to fetch the latest and only valid nonce (50).
   * @param signerAddress Signer's address
   * @param index Index in Nonce Store
   * @param contract Hub Contract
   */
  protected async accessNonceStore(index: BigNumber): Promise<BigNumber> {
    try {
      const replayProtection = new ReplayProtectionFactory(this.signer).attach(
        this.forwarderAddress
      );
      // In the ReplayProtection.sol, we use latestNonce == storedNonce then continue.
      // Onchain ID = H(signerAddress, index).
      // Mostly benefits bitflip & multinonce.
      const onchainId = keccak256(
        defaultAbiCoder.encode(
          ["address", "uint"],
          [this.signer.address, index]
        )
      );

      return await replayProtection.nonceStore(onchainId);
    } catch (e) {
      // Contract is not deployed. Very likely a new user, so return the default index 0.
      return new BigNumber("0");
    }
  }
}
