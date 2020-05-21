import {
  BigNumber,
  hexDataSlice,
  hexDataLength,
  defaultAbiCoder,
  Interface,
} from "ethers/utils";
import { TransactionReceipt } from "ethers/providers";

export function flipBit(bits: BigNumber, bitToFlip: BigNumber): BigNumber {
  return new BigNumber(bits).add(new BigNumber(2).pow(bitToFlip));
}
