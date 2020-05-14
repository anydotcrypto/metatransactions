import { ReplayProtectionType, ChainID, ProxyAccountForwarder } from "../..";
import { Wallet } from "ethers";
import { ForwarderFactory } from "./forwarderFactory";
import {
  PROXY_ACCOUNT_DEPLOYER_ADDRESS,
  BASE_ACCOUNT_ADDRESS,
} from "../../deployment/addresses";

export class ProxyAccountForwarderFactory extends ForwarderFactory<
  ProxyAccountForwarder
> {
  /**
   * Create a new instance of the forwarder
   * @param chainid MAINNET or ROPSTEN
   * @param replayProtectionType Bitflip, Multinonce or Nonce
   * @param signer Signer's wallet
   */
  public createNew(
    chainid: ChainID,
    replayProtectionType: ReplayProtectionType,
    signer: Wallet
  ): ProxyAccountForwarder {
    const proxyAccountAddress = ProxyAccountForwarder.buildProxyAccountAddress(
      signer.address
    );

    return new ProxyAccountForwarder(
      chainid,
      PROXY_ACCOUNT_DEPLOYER_ADDRESS,
      signer,
      proxyAccountAddress,
      this.getReplayProtection(
        signer,
        proxyAccountAddress,
        replayProtectionType
      )
    );
  }
}
