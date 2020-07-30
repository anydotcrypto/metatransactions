import { MinimalTx } from "../..";

export interface WalletForwarder {
  isWalletDeployed(): Promise<boolean>;
  getWalletDeployTransaction(): Promise<MinimalTx>;
}
