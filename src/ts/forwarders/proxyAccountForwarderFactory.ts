import { ReplayProtectionType, ChainID, ProxyAccountForwarder } from "../..";
import { Signer } from "ethers";
import { ForwarderFactory } from "./forwarderFactory";
import { PROXY_ACCOUNT_DEPLOYER_ADDRESS } from "../../deployment/addresses";

export class ProxyAccountForwarderFactory extends ForwarderFactory<
  ProxyAccountForwarder
> {
  /**
   * Create a new instance of the forwarder
   * @param chainid MAINNET or ROPSTEN
   * @param replayProtectionType Bitflip, Multinonce or Nonce
   * @param signer Signer's wallet
   */
  protected async createInternal(
    chainid: ChainID,
    replayProtectionType: ReplayProtectionType,
    signer: Signer
  ): Promise<ProxyAccountForwarder> {
    const proxyAccountAddress = ProxyAccountForwarder.buildProxyAccountAddress(
      await signer.getAddress()
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

  private static cache: Map<string, ProxyAccountForwarder> = new Map();

  protected cacheForwarder(cacheId: string, forwarder: ProxyAccountForwarder) {
    if (!ProxyAccountForwarderFactory.cache.get(cacheId)) {
      ProxyAccountForwarderFactory.cache.set(cacheId, forwarder);
    }
  }
  protected getCachedForwarder(
    cacheId: string
  ): ProxyAccountForwarder | undefined {
    return ProxyAccountForwarderFactory.cache.get(cacheId);
  }
}
