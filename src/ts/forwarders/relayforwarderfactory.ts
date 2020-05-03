import {
  ForwarderFactory,
  ChainID,
  ReplayProtectionType,
  RelayHubForwarder,
  RelayHubFactory,
} from "../..";
import { Wallet } from "ethers";

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
    const addr = this.getDeployedForwarderAddress(chainid);

    const relayHub = new RelayHubFactory(signer).attach(addr);

    return new RelayHubForwarder(
      chainid,
      relayHub,
      signer,
      this.getReplayProtection(signer, relayHub.address, replayProtectionType)
    );
  }

  /**
   * Pre-deployed contracts for easy of use
   * @param chainid Mainnet or Ropsten
   */
  public getDeployedForwarderAddress(chainid: ChainID): string {
    if (chainid == ChainID.MAINNET) {
      return "0x7915DCbe8E2b132832c63E0704D9EBBbD5800dd8" as string;
    }

    if (chainid == ChainID.ROPSTEN) {
      return "0xdFaed94BCDbe2Ca6399F78621925AD1D5b851750" as string;
    }

    throw new Error(
      "Please specify a valid ChainID for the ProxyAccountForwarder"
    );
  }
}
