import { Wallet, Contract } from "ethers";
import { ForwarderType, MetaTxHandler } from "./metatxhandler";
import { ProxyAccountFactory } from "..";
import { ForwardParams } from "./forwarder";

export class RelayerAPI {
  constructor(private readonly contract: Contract) {}
  /**
   * Returns the encoded calldata for the relay contract. Used by the relayer
   * to .call() into the RelayHub/ProxyAccount before .call() into the TargetContract.
   * @param user User's wallet
   * @param params Forward parameters
   */
  public async getForwardCallData(relayer: Wallet, params: ForwardParams) {
    const type = MetaTxHandler.getContractType(this.contract);

    if (type === ForwarderType.PROXYHUB) {
      // Reverts if the ProxyAccount does not exist.
      const proxyAccount = await this.getProxyAccountContract(
        relayer,
        params.signer
      );

      const callData = proxyAccount.interface.functions.forward.encode([
        params.target,
        params.value,
        params.data,
        params.replayProtection,
        params.replayProtectionAuthority,
        params.signature,
      ]);

      return callData;
    }

    // Send via the relay hub
    const callData = this.contract.interface.functions.forward.encode([
      params.target,
      params.data,
      params.replayProtection,
      params.replayProtectionAuthority,
      params.signer,
      params.signature,
    ]);

    return callData;
  }

  /**
   * Easy method for a relayer to forward a pre-approved meta-transaction
   * Takes care of working out if it is a ContractHub, ContractAccount or RelayHub.
   * @param relayer Relayer's wallet
   * @param params Forwarding parameters (signed meta-transaction)
   */
  public async forward(relayer: Wallet, params: ForwardParams) {
    const callData = this.getForwardCallData(relayer, params);

    return relayer.sendTransaction({
      to: params.to, // Potentially a ProxyAccount
      data: callData,
    });
  }

  /**
   * If it is a ProxyHub, we will fetch the signer's contract account address.
   * Otherwise, it will throw an error.
   * @param signer Signer's wallet
   * @returns Proxy account contract
   * @throws If the MetaTxHandler is not set up with the ProxyHub contract or if the Proxy account does not yet exist.
   */
  private async getProxyAccountContract(
    signer: Wallet,
    ownerOfProxyAccountAddr: string
  ): Promise<Contract> {
    const type = MetaTxHandler.getContractType(this.contract);
    if (type === ForwarderType.PROXYHUB) {
      // Let's fetch the relevant proxy contract
      // All proxy accounts are listed - according to the owner's signing address.
      const proxyAccountAddr = await this.contract.accounts(
        ownerOfProxyAccountAddr
      );

      // Confirm the proxy account exists.
      if (proxyAccountAddr === "0x0000000000000000000000000000000000000000") {
        throw new Error("Proxy account does not exist.");
      }

      return new ProxyAccountFactory(signer).attach(proxyAccountAddr);
    }

    throw new Error(
      "ProxyAccounts can only be fetched if a ProxyHub contract is installed for this MetaTxHandler"
    );
  }
}
