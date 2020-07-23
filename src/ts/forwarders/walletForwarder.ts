import {
  Forwarder,
  ProxyAccountCallData,
  ProxyAccountDeployCallData,
  RevertableProxyAccountCallData,
  RevertableProxyAccountDeployCallData,
  MinimalTx,
} from "../..";

export abstract class WalletForwarder extends Forwarder<
  ProxyAccountCallData,
  ProxyAccountDeployCallData,
  RevertableProxyAccountCallData,
  RevertableProxyAccountDeployCallData
> {
  public abstract async isContractDeployed(): Promise<boolean>;
  public abstract async createProxyContract(): Promise<MinimalTx>;
}
