import {
  ForwarderFactory,
  ChainID,
  ReplayProtectionType,
  RelayHubForwarder,
} from "../..";
import { Wallet } from "ethers";
import { RELAY_HUB_ADDRESS } from "../../deployment/addresses";

export class RelayHubForwarderFactory extends ForwarderFactory<
  RelayHubForwarder
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
  ): RelayHubForwarder {
    return new RelayHubForwarder(
      chainid,
      signer,
      RELAY_HUB_ADDRESS,
      this.getReplayProtection(signer, RELAY_HUB_ADDRESS, replayProtectionType)
    );
  }
}
