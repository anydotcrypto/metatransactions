import { abi } from "../../typedContracts/MultiSend.json";
import { Interface } from "ethers/utils";
import { MinimalTx, RevertableMinimalTx } from "../forwarders/forwarder";
import { MULTI_SEND_ADDRESS } from "../../deployment/addresses";
import { MultiSend } from "../../typedContracts/MultiSend";

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
   * Note each RevertableMinimalTx has a "revertOnFail" parameter which if set to true
   * and the tx fails it will roll back the entire batch.
   * @param batch List of minimal transactions
   * @returns A minimal transaction for the MultiSend contract
   */
  public batch(batch: RevertableMinimalTx[]): MinimalTx {
    const multiSend = new Interface(abi) as MultiSend["interface"];
    const to: string[] = [];
    const data: string[] = [];
    const value: string[] = [];
    const revertIfFail: boolean[] = [];

    for (const tx of batch) {
      to.push(tx.to);
      data.push(tx.data);
      value.push(tx.value ? tx.value : "0");
      revertIfFail.push(tx.revertOnFail);
    }

    const encodedTransactions = multiSend.functions.batch.encode([
      to,
      value,
      data,
      revertIfFail,
    ]);

    return {
      to: this.sender,
      data: encodedTransactions,
    };
  }
}
