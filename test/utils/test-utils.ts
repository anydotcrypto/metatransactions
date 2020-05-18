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

// I can't seem to set the type as TransactionReceipt
export function getForwardRevertReason(
  logInterface: Interface,
  receipt: TransactionReceipt
) {
  const revertReasons = [];
  if (receipt.logs) {
    // Go through each log and try to find a Forward event
    for (let i = 0; i < receipt.logs.length; i++) {
      const log = receipt.logs[i];
      const parsed = logInterface.parseLog(log);

      // Did we find a log from the Relay Hub?
      if (parsed != null) {
        const reason = parsed.values["reason"];
        // Did we find the forward event?
        if (parsed.values["reason"]) {
          // OK lets parse it!
          if (
            hexDataLength(reason) % 32 === 4 &&
            hexDataSlice(reason, 0, 4) === "0x08c379a0"
          ) {
            let revertReason = defaultAbiCoder.decode(
              ["string"],
              hexDataSlice(reason, 4)
            );
            revertReasons.push(revertReason[0]);
          }
        }
      }
    }
  }

  return revertReasons;
}
