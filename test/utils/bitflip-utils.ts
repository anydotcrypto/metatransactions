import { BigNumber } from "ethers/utils";

export function flipBit(bits: BigNumber, bitToFlip: BigNumber): BigNumber {
  return new BigNumber(bits).add(new BigNumber(2).pow(bitToFlip));
}
