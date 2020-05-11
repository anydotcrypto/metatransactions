import { EncodedTx } from "../forwarders/forwarder";
import { MultiSend } from "../../typedContracts/MultiSend";

interface TxToBatch {
  to: string;
  data: string;
  revertIfFail: boolean;
}
export class MultiSender {
  constructor(private readonly multiSend: MultiSend) {}

  public async batch(batch: TxToBatch[]): Promise<EncodedTx> {
    const to: string[] = [];
    const data: string[] = [];
    const revertIfFail: boolean[] = [];

    for (const tx of batch) {
      to.push(tx.to);
      data.push(tx.data);
      revertIfFail.push(tx.revertIfFail);
    }

    const encodedTransactions = this.multiSend.interface.functions.batch.encode(
      [to, data, revertIfFail]
    );

    return {
      to: this.multiSend.address,
      data: encodedTransactions,
      gas: 0,
    };
  }
}
