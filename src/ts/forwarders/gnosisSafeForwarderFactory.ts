import { ChainID } from "../..";
import { Signer } from "ethers";
import {
  ForwarderFactory,
  ForwarderType,
  ReplayProtectionType,
} from "./forwarderFactory";
import { GnosisSafeForwarder } from "./gnosisSafeForwarder";

export class GnosisSafeForwarderFactory extends ForwarderFactory<
  GnosisSafeForwarder
> {
  public constructor() {
    super(ForwarderType.GnosisSafe);
  }

  /**
   * Create a new instance of the forwarder. Does not get or set in forwarder cache.
   * @param chainid MAINNET or ROPSTEN
   * @param replayProtectionType Ignored for GnosisSafe. Can be any value.
   * @param signer Signer's wallet
   */
  public async createNew(
    chainid: ChainID,
    replayProtectionType: ReplayProtectionType,
    signer: Signer
  ): Promise<GnosisSafeForwarder> {
    return new GnosisSafeForwarder(chainid, signer, await signer.getAddress());
  }
}
