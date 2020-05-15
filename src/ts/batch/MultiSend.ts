import { MinimalTx } from "../forwarders/forwarder";
import { MultiSendFactory } from "../../typedContracts/MultiSendFactory";
import { MULTI_SEND_ADDRESS } from "../../deployment/addresses";
import { Signer } from "ethers";

/**
 * Batch a list of meta-transactions before it hits the forwarder.
 * Useful for deploying proxy contract and then sending meta-tx
 * in a single Ethereum Transaction.
 */
export class MultiSender {
  /**
   * Given a list of minimal transactions, it'll prepare a single
   * minimal transaction that is sent via the MultiSend contract.
   * @param signer Signer's wallet
   * @param batch List of minimal transactions
   * @returns A minimal transaction for the MultiSend contract
   */
  public async batch(signer: Signer, batch: MinimalTx[]): Promise<MinimalTx> {
    const multiSend = new MultiSendFactory(signer).attach(MULTI_SEND_ADDRESS);
    const to: string[] = [];
    const data: string[] = [];
    const revertIfFail: boolean[] = [];

    for (const tx of batch) {
      to.push(tx.to);
      data.push(tx.data);

      // Cannot do the ? : trick as undefined/false
      // have the same behaviour.
      if (tx.revertIfFail === undefined) {
        revertIfFail.push(true);
      } else {
        revertIfFail.push(tx.revertIfFail);
      }
    }

    const encodedTransactions = multiSend.interface.functions.batch.encode([
      to,
      data,
      revertIfFail,
    ]);

    return {
      to: multiSend.address,
      data: encodedTransactions,
    };
  }
}
