import { BigNumber } from "ethers/utils";
import { Contract } from "ethers";

export interface Nonces {
  index: number;
  latestNonce: BigNumber;
}

export abstract class ReplayProtectionAuthority {
  abstract getAddress(): string;

  abstract async getEncodedReplayProtection(
    signerAddress: string,
    hubContract: Contract
  ): Promise<string>;
}
