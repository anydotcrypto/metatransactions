import { ReplayProtectionType, ChainID, ProxyAccountForwarder } from "../..";
import { Signer } from "ethers";
import { ForwarderFactory, ForwarderType } from "./forwarderFactory";
import { PROXY_ACCOUNT_DEPLOYER_ADDRESS } from "../../deployment/addresses";

export class ProxyAccountForwarderFactory extends ForwarderFactory<
  ProxyAccountForwarder
> {
  public constructor() {
    super(ForwarderType.ProxyAccount);
  }

  /**
   * Create a new instance of the forwarder. Does not get or set in forwarder cache.
   * @param chainid MAINNET or ROPSTEN
   * @param replayProtectionType Bitflip, Multinonce or Nonce
   * @param signer Signer's wallet
   */
  public async createNew(
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
}
