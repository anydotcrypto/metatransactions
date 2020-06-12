import { abi } from "../../typedContracts/MultiSend.json";
import { Interface, BigNumberish } from "ethers/utils";
import {
  MinimalTx,
  CallType,
} from "../forwarders/forwarder";
import { MULTI_SEND_ADDRESS } from "../../deployment/addresses";
import { MultiSend } from "../../typedContracts/MultiSend";


export interface MultiSendTx extends MinimalTx {
    callType?: CallType;
    revertOnFail?: boolean;
    value?: BigNumberish
  }

/**
 * Batch a list of meta-transactions before it hits the forwarder.
 */
export class MultiSender {
  private sender: string;

  constructor(multiSendAddress?: string) {
    this.sender = multiSendAddress ? multiSendAddress : MULTI_SEND_ADDRESS;
  }

  /**
   * Given a list of minimal transactions, it'll prepare a single
   * minimal transaction that is sent via the MultiSend contract.
   * Note each MultiSendTx has a "revertOnFail" parameter which if set to true
   * and the tx fails it will roll back the entire batch.
   * @param batch List of minimal transactions
   * @returns A minimal transaction for the MultiSend contract
   */
  public batch(batch: MultiSendTx[]): MinimalTx {
    const multiSend = new Interface(abi) as MultiSend["interface"];
    const transactions = [];

    for (let i = 0; i < batch.length; i++) {
      transactions.push({
        to: batch[i].to,
        value: batch[i].value ? (batch[i].value as BigNumberish) : 0,
        data: batch[i].data,
        revertOnFail: batch[i].revertOnFail
          ? (batch[i].revertOnFail as boolean)
          : false,
        callType: batch[i].callType
          ? (batch[i].callType as number)
          : CallType.CALL,
      });
    }
    const encodedTransactions = multiSend.functions.batch.encode([
      transactions,
    ]);

    return {
      to: this.sender,
      data: encodedTransactions,
    };
  }
}
