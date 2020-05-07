import {
  ReplayProtectionType,
  ChainID,
  ProxyAccountDeployerFactory,
  ProxyAccountForwarder,
} from "../..";
import { Wallet } from "ethers";
import { ForwarderFactory } from "./forwarderFactory";
import { MAINNET_PROXYDEPLOYER, ROPSTEN_PROXYDEPLOYER } from "../config";

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
    const proxyAddress = ProxyAccountForwarder.buildProxyAccountAddress(
      proxyAccountDeployer.address,
      signer.address,
      baseAccount
    );

    return new ProxyAccountForwarder(
      chainid,
      proxyAccountDeployerAddr,
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
      return MAINNET_PROXYDEPLOYER;
    }

    if (chainid == ChainID.ROPSTEN) {
      return ROPSTEN_PROXYDEPLOYER;
    }

    throw new Error(
      "Please specify ChainID.MAINNET or ChainID.ROPSTEN for the ProxyDeployer contract"
    );
  }
}
