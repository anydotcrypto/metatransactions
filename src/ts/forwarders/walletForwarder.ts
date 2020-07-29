import { MinimalTx } from "../..";

export interface WalletForwarder {
  isContractDeployed(): Promise<boolean>;
  createProxyContract(): Promise<MinimalTx>;
}
