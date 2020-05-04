import {
  ReplayProtectionType,
  ChainID,
  ProxyAccountDeployerFactory,
  ProxyAccountForwarder,
} from "../..";
import { Wallet } from "ethers";
import { ForwarderFactory } from "./forwarderfactory";

export class ProxyAccountForwarderFactory extends ForwarderFactory<
  ProxyAccountForwarder
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
  ): Promise<ProxyAccountForwarder> {
    const proxyAccountDeployerAddr = this.getProxyAccountDeployerAddress(
      chainid
    );

    const proxyAccountDeployer = new ProxyAccountDeployerFactory(signer).attach(
      proxyAccountDeployerAddr
    );
    const baseAccount = await proxyAccountDeployer.baseAccount();
    const proxyAddress = ProxyAccountForwarder.buildCreate2Address(
      proxyAccountDeployer.address,
      signer.address,
      baseAccount
    );

    return new ProxyAccountForwarder(
      chainid,
      proxyAccountDeployer,
      signer,
      this.getReplayProtection(signer, proxyAddress, replayProtectionType)
    );
  }

  /**
   * Fetches address of the deployed ProxyAccountDeployer.
   * It is responsible for creating proxy account factorties.
   * @param chainid Mainnet or Ropsten
   */
  public getProxyAccountDeployerAddress(chainid: ChainID): string {
    if (chainid == ChainID.MAINNET) {
      return "0x894CEd16b2710B90763e7daa83829fec7Ebd31E9" as string;
    }

    if (chainid == ChainID.ROPSTEN) {
      return "0xc9d6292CA60605CB2d443a5395737a307E417E53" as string;
    }

    throw new Error(
      "Please specify a valid ChainID for the ProxyAccountForwarder"
    );
  }
}
