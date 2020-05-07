import {
  ForwarderFactory,
  ChainID,
  ReplayProtectionType,
  RelayHubForwarder,
} from "../..";
import { Wallet } from "ethers";
import { ROPSTEN_RELAYHUB, MAINNET_RELAYHUB } from "../config";

export class RelayHubForwarderFactory extends ForwarderFactory<
  RelayHubForwarder
> {
  /**
   * Create a new instance of the forwarder
   * @param chainid MAINNET or ROPSTEN
   * @param replayProtectionType Bitflip, Multinonce or Nonce
   * @param signer Signer's wallet
   */
  public async createNew(
    chainid: ChainID,
    replayProtectionType: ReplayProtectionType,
    signer: Wallet
  ): Promise<RelayHubForwarder> {
    const relayHubAddress = this.getDeployedRelayHubAddress(chainid);

    return new RelayHubForwarder(
      chainid,
      relayHubAddress,
      signer,
      this.getReplayProtection(signer, relayHubAddress, replayProtectionType)
    );
  }

  /**
   * Pre-deployed contracts for easy of use
   * @param chainid Mainnet or Ropsten
   */
  public getDeployedRelayHubAddress(chainid: ChainID): string {
    if (chainid == ChainID.MAINNET) {
      return MAINNET_RELAYHUB;
    }

    if (chainid == ChainID.ROPSTEN) {
      return ROPSTEN_RELAYHUB;
    }

    throw new Error(
      "Please specify ChainID.MAINNET or ChainID.ROPSTEN for the RelayHub contract"
    );
  }
}
