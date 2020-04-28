import { keccak256, arrayify, defaultAbiCoder, BigNumber } from "ethers/utils";
import { Wallet } from "ethers/wallet";
import { Contract } from "ethers";
import { MultiNonce } from "./multinonce";
import { ReplayProtectionAuthority } from "./replayprotectionauthority";
import { BitFlip } from "./bitflip";
import { ProxyAccountFactory } from "../typedContracts/ProxyAccountFactory";
import { RelayHubFactory, ProxyHubFactory } from "..";

export interface ForwardParams {
  hub: string;
  signer: string;
  target: string;
  value: string;
  data: string;
  replayProtection: string;
  replayProtectionAuthority: string;
  chainId: number;
  signature: string;
}

enum ContractType {
  RELAYHUB,
  PROXYACCOUNT,
  PROXYHUB,
}

/**
 * A single library for approving meta-transactions and its associated
 * replay protection.
 */
export class MetaTxHandler {
  private chainId: BigNumber;

  public static getHubAddress(name: string) {
    switch (name) {
      case "mainnet-relay":
        return "0x70107abB312db18bD9AdDec39CE711374B09EBC1";
      case "mainnet-proxy":
        return "0x0b116DF91Aae33d85840165c5487462E0E821242";
      case "ropsten-relay":
        return "0xE206a5C07aDE5ff4BA8805E68Fb0A52e12aE7798";
      case "ropsten-proxy":
        return "0x9b1D523DfA8A6b2B04d3A54D469b63525823ffC9";
      default:
        throw new Error("Please specify which network and hub to set up");
    }
  }

  /**
   * Multi-nonce replay protection with preset global hub
   * @param user Required for fetching the relay hub via the factory.
   * @param networkHub Available options: "mainnet-relay", "mainnet-proxy", "ropsten-relay", "ropsten-proxy"
   * @param concurrency Up to N concurrent and out-of-order transactions at a time
   * @throws If the network hub option is not available.
   * @returns A MetaTxHandler with multi-nonce replay protection.
   */
  public static multinoncePreset(
    user: Wallet,
    networkHub: string,
    concurrency: number
  ) {
    const addr = MetaTxHandler.getHubAddress(networkHub);

    if (networkHub.includes("relay")) {
      const relayHubFactory = new RelayHubFactory(user);
      const relayHub = relayHubFactory.attach(addr);
      return MetaTxHandler.multinonce(relayHub, concurrency);
    }

    if (networkHub.includes("proxy")) {
      const proxyHubFactory = new ProxyHubFactory(user);
      const proxyHub = proxyHubFactory.attach(addr);
      return MetaTxHandler.multinonce(proxyHub, concurrency);
    }

    throw new Error("Please specify which network and hub to set up");
  }

  /**
   * Bitflip replay protection
   * @param user Required for fetching the relay hub via the factory.
   * @param contract RelayHub, ProxyHub or ProxyAccount
   * @throws If the network hub option is not available.
   * @returns A MetaTxHandler with bitflip replay protection.
   */
  public static bitFlipPreset(user: Wallet, networkHub: string) {
    const addr = MetaTxHandler.getHubAddress(networkHub);

    if (networkHub.includes("relay")) {
      const relayHubFactory = new RelayHubFactory(user);
      const relayHub = relayHubFactory.attach(addr);
      return MetaTxHandler.bitFlip(relayHub);
    }

    if (networkHub.includes("proxy")) {
      const proxyHubFactory = new ProxyHubFactory(user);
      const proxyHub = proxyHubFactory.attach(addr);
      return MetaTxHandler.bitFlip(proxyHub);
    }

    throw new Error("Please specify which network and hub to set up");
  }

  /**
   * Multi-nonce replay protection
   * @param contract RelayHub, ProxyHub or ProxyAccount
   * @param concurrency Up to N concurrent transactions at a time
   */
  public static multinonce(contract: Contract, concurrency: number) {
    return new MetaTxHandler(contract, new MultiNonce(contract, concurrency));
  }

  /**
   * Multi-nonce replay protection
   * @param contract RelayHub, ProxyHub or ProxyAccount
   * @param concurrency Up to N concurrent transactions at a time
   */
  public static bitFlip(contract: Contract) {
    return new MetaTxHandler(contract, new BitFlip(contract));
  }

  /**
   * Sets up a MetaTxHandler with the desired ReplayProtection Authority.
   * @param contract RelayHub, ProxyHub or ProxyAccount
   * @param replayProtectionAuthority Extends implementation ReplayProtectionAuthority
   */
  constructor(
    private readonly contract: Contract,
    private readonly replayProtectionAuthority: ReplayProtectionAuthority
  ) {}

  /**
   * Standard encoding for contract call data
   * @param target Target contract
   * @param value Denominated in wei
   * @param callData Encoded function call with data
   */
  private getEncodedCallData(
    target: string,
    value: BigNumber,
    callData: string,
    contract: Contract
  ) {
    const type = this.contractType(contract);

    // Relay Hub does not have a "value" field for forward.
    if (type === ContractType.RELAYHUB) {
      return defaultAbiCoder.encode(["address", "bytes"], [target, callData]);
    }

    // ProxyAccounts have a "value" field.
    return defaultAbiCoder.encode(
      ["address", "uint", "bytes"],
      [target, value, callData]
    );
  }

  /**
   * A meta-transaction includes:
   * - Calldata
   * - Replay protection (and authority)
   * - Verifier contract address
   *
   * We compute and return the encoded meta-transaction to be signed.
   * @param encodedCallData Encoding includes target, value and calldata
   * @param encodedReplayProtection Encoding includes the replay protection nonces (e.g. typically 2 nonces)
   * @param replayProtectionAuthority Address of replay protection
   * @param contract Contract for verifying the replay protection
   */
  private encodeMetaTransactionToSign(
    encodedCallData: string,
    encodedReplayProtection: string,
    replayProtectionAuthority: string,
    contract: Contract,
    chainId: BigNumber
  ): string {
    // We expect encoded call data to include target contract address, the value, and the callData.
    return defaultAbiCoder.encode(
      ["bytes", "bytes", "address", "address", "uint"],
      [
        encodedCallData,
        encodedReplayProtection,
        replayProtectionAuthority,
        contract.address,
        chainId,
      ]
    );
  }

  /**
   * If it is a ProxyHub, we will fetch the signer's contract account address.
   * Otherwise, return address as normal (RelayHub or ProxyAccount)
   * @param signer Signer's wallet
   */
  public async getProxyAccountContract(
    signer: Wallet,
    ownerOfProxyAccountAddr: string
  ) {
    const type = this.contractType(this.contract);

    if (type === ContractType.PROXYHUB) {
      // Let's fetch the relevant proxy contract
      // All proxy accounts are listed - according to the owner's signing address.
      const proxyAccountAddr = await this.contract.accounts(
        ownerOfProxyAccountAddr
      );

      // Confirm the proxy account exists.
      if (proxyAccountAddr === "0x0000000000000000000000000000000000000000") {
        throw new Error("Proxy account does not exist.");
      }

      const proxyAccountFactory = new ProxyAccountFactory(signer);
      const hub = proxyAccountFactory.attach(proxyAccountAddr);

      return hub;
    }

    throw new Error(
      "ProxyAccounts can only be fetched if a ProxyHub contract is installed for this MetaTxHandler"
    );
  }
  /**
   * Easy method for signing a meta-transaction. Takes care of replay protection.]
   * @param signer Signer's wallet
   * @param target Target contract address
   * @param value Value to send
   * @param msgSenderCall Encoded calldata
   */
  public async signMetaTransaction(
    signer: Wallet,
    target: string,
    value: BigNumber,
    callData: string
  ) {
    const type = this.contractType(this.contract);
    let hub = this.contract;

    if (type === ContractType.PROXYHUB) {
      hub = await this.getProxyAccountContract(signer, signer.address);
    }

    // Fetch chain ID
    if (!this.chainId) {
      this.chainId = await hub.connect(signer).getChainID();
    }

    // Encode expected data
    const encodedReplayProtection = await this.replayProtectionAuthority.getEncodedReplayProtection(
      signer.address,
      hub
    );

    const encodedCallData = this.getEncodedCallData(
      target,
      value,
      callData,
      hub
    );
    const encodedData = this.encodeMetaTransactionToSign(
      encodedCallData,
      encodedReplayProtection,
      this.replayProtectionAuthority.getAddress(),
      hub,
      this.chainId
    );

    const signature = await signer.signMessage(
      arrayify(keccak256(encodedData))
    );

    const params: ForwardParams = {
      hub: hub.address,
      signer: signer.address,
      target: target,
      value: value.toString(),
      data: callData,
      replayProtection: encodedReplayProtection,
      replayProtectionAuthority: this.replayProtectionAuthority.getAddress(),
      chainId: this.chainId.toNumber(),
      signature: signature,
    };

    return params;
  }

  /**
   * Easy method for signing a meta-transaction. Takes care of replay protection.
   * Note it is using replace-by-nonce, and not multinonce as the "index" is always 0.
   * @param relayHubAddress Relay or Contract Hub address
   * @param signer Signer's wallet
   * @param target Target contract address
   * @param value Value to send
   * @param msgSenderCall Encoded calldata
   */
  public async signMetaDeployment(signer: Wallet, initCode: string) {
    const hub = this.contract;
    const type = this.contractType(this.contract);

    // Proxy Account has a deploy function function.
    if (type === ContractType.PROXYHUB) {
      return await this.getProxyAccountContract(signer, signer.address);
    }

    // Fetch chain ID
    if (!this.chainId) {
      this.chainId = await this.getChainID(signer);
    }

    // Encode expected data
    const encodedReplayProtection = await this.replayProtectionAuthority.getEncodedReplayProtection(
      signer.address,
      hub
    );

    const encodedData = this.encodeMetaTransactionToSign(
      initCode,
      encodedReplayProtection,
      this.replayProtectionAuthority.getAddress(),
      hub,
      this.chainId
    );

    const signature = await signer.signMessage(
      arrayify(keccak256(encodedData))
    );

    const params: ForwardParams = {
      hub: hub.address,
      signer: signer.address,
      target: "0x0000000000000000000000000000000000000000",
      value: "0",
      data: initCode,
      replayProtection: encodedReplayProtection,
      replayProtectionAuthority: this.replayProtectionAuthority.getAddress(),
      chainId: this.chainId.toNumber(),
      signature: signature,
    };

    return params;
  }

  /**
   * Returns the encoded calldata for the relay contract. Used by the relayer
   * to .call() into the RelayHub/ProxyAccount before .call() into the TargetContract.
   * @param user User's wallet
   * @param params Forward parameters
   */
  public async getForwardCallData(relayer: Wallet, params: ForwardParams) {
    let hub = this.contract;
    const type = this.contractType(hub);

    if (type === ContractType.PROXYHUB) {
      hub = await this.getProxyAccountContract(relayer, params.signer);

      const callData = hub.interface.functions.forward.encode([
        params.target,
        params.value,
        params.data,
        params.replayProtection,
        params.replayProtectionAuthority,
        params.signature,
      ]);

      return callData;
    }

    // Send via the relay hub
    const callData = hub.interface.functions.forward.encode([
      params.target,
      params.data,
      params.replayProtection,
      params.replayProtectionAuthority,
      params.signer,
      params.signature,
    ]);

    return callData;
  }

  /**
   * Easy method for a relayer to forward a pre-approved meta-transaction
   * Takes care of working out if it is a ContractHub, ContractAccount or RelayHub.
   * @param relayer Relayer's wallet
   * @param params Forwarding parameters (signed meta-transaction)
   */
  public async forward(relayer: Wallet, params: ForwardParams) {
    const callData = this.getForwardCallData(relayer, params);

    return relayer.sendTransaction({
      to: params.hub, // Potentially a ProxyAccount
      data: callData,
    });
  }

  /**
   * Unfortunately, instanceof does not work when compiled
   * to javascript. In order to detect if the hub is a ProxyAccount,
   * RelayHub or ProxyHub - we rely on checking the existance of a
   * function.
   * - init() is only available in a ProxyAccount
   * - accounts() is only available in a ProxyHub
   * If neither function is detected, we assume it is a RelayHub.
   * @param hub Contract
   */
  private contractType(contract: Contract) {
    if (contract.init) {
      return ContractType.PROXYACCOUNT;
    }

    if (contract.accounts) {
      return ContractType.PROXYHUB;
    }

    return ContractType.RELAYHUB;
  }

  private async getChainID(signer: Wallet) {
    return await this.contract.connect(signer).getChainID();
  }
}
