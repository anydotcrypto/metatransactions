import { BigNumber, keccak256, defaultAbiCoder } from "ethers/utils";
import { Contract } from "ethers";
import { RelayHub } from "..";

export interface Nonces {
  index: BigNumber;
  latestNonce: BigNumber;
}

export abstract class ReplayProtectionAuthority {
  abstract getAddress(): string;

  abstract async getEncodedReplayProtection(
    signerAddress: string,
    hubContract: Contract
  ): Promise<string>;

  protected async accessHubNonceStore(
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
