import { keccak256, arrayify, defaultAbiCoder, BigNumber } from "ethers/utils";
import { Wallet } from "ethers/wallet";
import { Contract } from "ethers";
import { MultiNonce } from "./multinonce";
import { ReplayProtectionAuthority } from "./replayprotection";
import { BitFlip } from "./bitflip";
import { ProxyAccountFactory } from "../typedContracts/ProxyAccountFactory";
import { RelayHubFactory, ProxyHubFactory } from "../../dist";

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

/**
 * A single library for approving meta-transactions and its associated
 * replay protection.
 */
export class HubReplayProtection {
  private chainId: BigNumber;

  /**
   * Multi-nonce replay protection with preset global hub
   * @param networkHub Available options: "ropsten-relay", "ropsten-proxy"
   * @param concurrency Up to N concurrent transactions at a time
   */
  public static multinoncePreset(
    user: Wallet,
    networkHub: string,
    concurrency: number
  ) {
    switch (networkHub) {
      case "ropsten-relay":
        const relayHubFactory = new RelayHubFactory(user);
        const relayHub = relayHubFactory.attach(
          "0xE206a5C07aDE5ff4BA8805E68Fb0A52e12aE7798"
        );
        return HubReplayProtection.multinonce(relayHub, concurrency);
      case "ropsten-proxy":
        const proxyHubFactory = new ProxyHubFactory(user);
        const proxyHub = proxyHubFactory.attach(
          "0x9b1D523DfA8A6b2B04d3A54D469b63525823ffC9"
        );
        return HubReplayProtection.multinonce(proxyHub, concurrency);

      default:
        throw new Error("Please specify which network and hub to set up");
    }
  }

  /**
   * Multi-nonce replay protection
   * @param hubContract RelayHub, ProxyHub or ProxyAccount
   * @param concurrency Up to N concurrent transactions at a time
   */
  public static bitFlipPreset(user: Wallet, networkHub: string) {
    switch (networkHub) {
      case "ropsten-relay":
        const relayHubFactory = new RelayHubFactory(user);
        const relayHub = relayHubFactory.attach(
          "0xE206a5C07aDE5ff4BA8805E68Fb0A52e12aE7798"
        );
        return HubReplayProtection.bitFlip(relayHub);
      case "ropsten-proxy":
        const proxyHubFactory = new ProxyHubFactory(user);
        const proxyHub = proxyHubFactory.attach(
          "0x9b1D523DfA8A6b2B04d3A54D469b63525823ffC9"
        );
        return HubReplayProtection.bitFlip(proxyHub);
      default:
        throw new Error("Please specify which network and hub to set up");
    }
  }

  /**
   * Multi-nonce replay protection
   * @param hubContract RelayHub, ProxyHub or ProxyAccount
   * @param concurrency Up to N concurrent transactions at a time
   */
  public static multinonce(hubContract: Contract, concurrency: number) {
    return new HubReplayProtection(
      hubContract,
      new MultiNonce(hubContract, concurrency)
    );
  }

  /**
   * Multi-nonce replay protection
   * @param hubContract RelayHub, ProxyHub or ProxyAccount
   * @param concurrency Up to N concurrent transactions at a time
   */
  public static bitFlip(hubContract: Contract) {
    return new HubReplayProtection(hubContract, new BitFlip(hubContract));
  }

  /**
   * Initialize replay protection with replay-by-nonce
   * @param hubContract RelayHub, ProxyHub or ProxyAccount
   */
  constructor(
    private readonly hubContract: Contract,
    private readonly replayProtectionAuthority: ReplayProtectionAuthority
  ) {}

  /**
   * Standard encoding for contract call data
   * @param target Target contract
   * @param value Denominated in wei
   * @param callData Encoded function call with data
   */
  public getEncodedCallData(
    target: string,
    value: BigNumber,
    callData: string
  ) {
    return defaultAbiCoder.encode(
      ["address", "uint", "bytes"],
      [target, value, callData]
    );
  }

  /**
   *
   * @param encodedCallData Encoding includes target, value and calldata
   * @param encodedReplayProtection Encoding includes the replay protection nonces (e.g. typically 2 nonces)
   * @param replayProtectionAuthority Address of replay protection
   */
  public encodeMetaTransactionToSign(
    encodedCallData: string,
    encodedReplayProtection: string,
    replayProtectionAuthority: string,
    proxyContract: Contract
  ): string {
    // We expect encoded call data to include target contract address, the value, and the callData.
    // Message signed: H(encodedCallData, encodedReplayProtection, replay protection authority, relay contract address, chainid);
    return defaultAbiCoder.encode(
      ["bytes", "bytes", "address", "address", "uint"],
      [
        encodedCallData,
        encodedReplayProtection,
        replayProtectionAuthority,
        proxyContract.address,
        0,
      ]
    );
  }

  /**
   * Fetch encoded replay protection from the authority
   * @param signer Signer
   */
  public async getEncodedReplayProtection(
    signer: Wallet,
    hubContract: Contract
  ) {
    return await this.replayProtectionAuthority.getEncodedReplayProtection(
      signer.address,
      hubContract
    );
  }

  /**
   * If it is a ContractHub, we will fetch the signer's contract account address.
   * Otherwise, return address as normal (Relay Hub or Contract Account)
   * @param signer Signer's wallet
   */
  public async getHub(signer: Wallet) {
    // Fetch chain ID
    if (!this.chainId) {
      this.chainId = await this.hubContract.connect(signer).getChainID();
    }

    // Are we handling a contract hub?
    if (this.hubContract.accounts) {
      // Let's fetch the relevant proxy contract
      const proxyAccountAddr = await this.hubContract.accounts(signer.address);

      // Confirm the proxy account exists.
      if (proxyAccountAddr === "0x0000000000000000000000000000000000000000") {
        throw new Error("Contract account does not exist.");
      }

      const proxyAccountFactory = new ProxyAccountFactory(signer);
      const hub = proxyAccountFactory.attach(proxyAccountAddr);

      return hub;
    }

    return this.hubContract;
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
    const hub = await this.getHub(signer);

    // Encode expected data
    const encodedReplayProtection = await this.replayProtectionAuthority.getEncodedReplayProtection(
      signer.address,
      hub
    );
    const encodedCallData = this.getEncodedCallData(target, value, callData);
    const encodedData = this.encodeMetaTransactionToSign(
      encodedCallData,
      encodedReplayProtection,
      this.replayProtectionAuthority.getAddress(),
      hub
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
    const hub = await this.getHub(signer);

    // Encode expected data
    const encodedReplayProtection = await this.replayProtectionAuthority.getEncodedReplayProtection(
      signer.address,
      hub
    );

    const encodedData = this.encodeMetaTransactionToSign(
      initCode,
      encodedReplayProtection,
      this.replayProtectionAuthority.getAddress(),
      hub
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
   * Returns the encoded calldata. This lets a relayer
   * to .call() into the RelayHub before .call() into the Target contract.
   * @param params Forward parameters
   */
  public async encodeForwardParams(user: Wallet, params: ForwardParams) {
    let hub = this.hubContract;

    // Fetch the relevant contract account
    // instanceof doesn't work becaue js is poo
    if (this.hubContract.accounts) {
      const proxyAccountAddr = await this.hubContract.accounts(params.signer);
      const factory = new ProxyAccountFactory(user);
      hub = factory.attach(proxyAccountAddr);
    }

    if (hub.init) {
      // Must be a contract account
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
      params.value,
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
    let hub = this.hubContract;

    // Fetch the relevant contract account
    // instanceof doesn't work becaue js is poo
    if (this.hubContract.accounts) {
      const proxyAccountAddr = await this.hubContract.accounts(params.signer);
      const factory = new ProxyAccountFactory(relayer);
      hub = factory.attach(proxyAccountAddr);
    }

    if (hub.init) {
      // Must be a contract account
      const tx = await hub
        .connect(relayer)
        .forward(
          params.target,
          params.value,
          params.data,
          params.replayProtection,
          params.replayProtectionAuthority,
          params.signature
        );

      return await tx;
    }

    // Send via the relay hub
    let tx = this.hubContract
      .connect(relayer)
      .forward(
        params.target,
        params.value,
        params.data,
        params.replayProtection,
        params.replayProtectionAuthority,
        params.signer,
        params.signature
      );

    return await tx;
  }
}
