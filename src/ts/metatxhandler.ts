import {
  keccak256,
  arrayify,
  defaultAbiCoder,
  BigNumber,
  solidityKeccak256,
} from "ethers/utils";
import { Wallet } from "ethers/wallet";
import { Contract } from "ethers";
import { MultiNonce } from "./multinonce";
import { ReplayProtectionAuthority } from "./replayprotectionauthority";
import { BitFlip } from "./bitflip";
import { ProxyHubFactory } from "..";

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

export interface DeploymentParams {
  hub: string;
  signer: string;
  data: string;
  replayProtection: string;
  replayProtectionAuthority: string;
  chainId: number;
  signature: string;
}

export enum ContractType {
  RELAYHUB,
  PROXYACCOUNT,
  PROXYHUB,
}

export enum ChainID {
  MAINNET = 0,
  ROPSTEN = 1,
}

/**
 * A single library for approving meta-transactions and its associated
 * replay protection.
 */
export class MetaTxHandler {
  public static getHubAddress(chainid: ChainID, contractType: ContractType) {
    if (chainid === ChainID.MAINNET) {
      if (contractType === ContractType.RELAYHUB) {
        return "0x70107abB312db18bD9AdDec39CE711374B09EBC1";
      }

      if (contractType === ContractType.PROXYHUB) {
        return "0x0b116DF91Aae33d85840165c5487462E0E821242";
      }
    }

    if (chainid === ChainID.ROPSTEN) {
      if (contractType === ContractType.RELAYHUB) {
        return "0xE206a5C07aDE5ff4BA8805E68Fb0A52e12aE7798";
      }

      if (contractType === ContractType.PROXYHUB) {
        return "0x9b1D523DfA8A6b2B04d3A54D469b63525823ffC9";
      }
    }
    throw new Error("Please specify a valid ChainID and ContractType");
  }

  /**
   * Multi-nonce replay protection with preset global hub
   * @param chainID: ChainID (mainnet or ropsten)
   * @param contractType: RelayHub or ProxyHub
   * @param concurrency Up to N concurrent and out-of-order transactions at a time
   * @throws If the network hub option is not available.
   * @returns A MetaTxHandler with multi-nonce replay protection.
   */
  public static multinoncePreset(
    chainID: ChainID,
    contractType: ContractType,
    concurrency: number
  ) {
    // Throws if networkHub is not recognised
    const addr = MetaTxHandler.getHubAddress(chainID, contractType);

    if (contractType === ContractType.RELAYHUB) {
      return MetaTxHandler.multinonce(chainID, contractType, addr, concurrency);
    }

    if (contractType === ContractType.PROXYHUB) {
      return MetaTxHandler.multinonce(chainID, contractType, addr, concurrency);
    }
  }

  /**
   * Bitflip replay protection
   * @param chainID: ChainID (mainnet or ropsten)
   * @param contractType: RelayHub or ProxyHub
   * @throws If the network hub option is not available.
   * @returns A MetaTxHandler with bitflip replay protection.
   */
  public static bitFlipPreset(chainID: ChainID, contractType: ContractType) {
    const addr = MetaTxHandler.getHubAddress(chainID, contractType);

    if (contractType === ContractType.RELAYHUB) {
      return MetaTxHandler.bitFlip(chainID, contractType, addr);
    }

    if (contractType === ContractType.PROXYHUB) {
      return MetaTxHandler.bitFlip(chainID, contractType, addr);
    }

    throw new Error("Please specify which network and hub to set up");
  }

  /**
   * Multi-nonce replay protection
   * @param contract RelayHub, ProxyHub or ProxyAccount
   * @param concurrency Up to N concurrent transactions at a time
   */
  public static multinonce(
    chainID: ChainID,
    contractType: ContractType,
    contract: string,
    concurrency: number
  ) {
    return new MetaTxHandler(
      chainID,
      contractType,
      contract,
      new MultiNonce(contract, concurrency)
    );
  }

  /**
   * Multi-nonce replay protection
   * @param contract RelayHub, ProxyHub or ProxyAccount
   * @param concurrency Up to N concurrent transactions at a time
   */
  public static bitFlip(
    chainID: ChainID,
    contractType: ContractType,
    contract: string
  ) {
    return new MetaTxHandler(
      chainID,
      contractType,
      contract,
      new BitFlip(contract)
    );
  }

  /**
   * Sets up a MetaTxHandler with the desired ReplayProtection Authority.
   * @param contract RelayHub, ProxyHub or ProxyAccount
   * @param replayProtectionAuthority Extends implementation ReplayProtectionAuthority
   */
  constructor(
    private readonly chainID: ChainID,
    private readonly contractType: ContractType,
    private readonly contract: string,
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
    contractType: ContractType
  ) {
    // Relay Hub does not have a "value" field for forward.
    if (ContractType.RELAYHUB === contractType) {
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
    contract: string
  ): string {
    // We expect encoded call data to include target contract address, the value, and the callData.
    return defaultAbiCoder.encode(
      ["bytes", "bytes", "address", "address", "uint"],
      [
        encodedCallData,
        encodedReplayProtection,
        replayProtectionAuthority,
        contract,
        this.chainID,
      ]
    );
  }

  /**
   * Deploys a proxy contract for the user
   * @param wallet Wallet to sign Ethereum Transaction
   * @param userAddress User's Ethereum Account
   */
  public async createProxyContract(wallet: Wallet, userAddress: string) {
    // Only the ProxyHub can create proxy accounts. e.g. it maintains a registry.
    if (this.contractType === ContractType.PROXYHUB) {
      const proxyHub = new ProxyHubFactory(wallet).attach(this.contract);
      const deployed = await proxyHub.connect(wallet).accounts(userAddress);

      // Does the user have a proxy contract?
      if (deployed === "0x0000000000000000000000000000000000000000") {
        const tx = await proxyHub
          .connect(wallet)
          .createProxyAccount(userAddress);

        return tx;
      }
    } else {
      throw new Error("ProxyHub must be installed to create a ProxyContract");
    }
  }

  /**
   * Easy method for signing a meta-transaction. Takes care of replay protection.]
   * @param signer Signer's wallet
   * @param target Target contract address
   * @param value Value to send
   * @param callData Encoded calldata
   */
  public async signMetaTransaction(
    signer: Wallet,
    target: string,
    value: BigNumber,
    callData: string
  ) {
    let contractAddr = this.contract;

    // Proxy Account has a deploy function function.
    if (this.contractType === ContractType.PROXYHUB) {
      const proxyHub = new ProxyHubFactory(signer).attach(this.contract);
      const baseAddress = await proxyHub.baseAccount();

      contractAddr = MetaTxHandler.buildCreate2Address(
        proxyHub.address,
        signer.address,
        baseAddress
      );
    }
    const encodedReplayProtection = await this.replayProtectionAuthority.getEncodedReplayProtection(
      signer,
      contractAddr
    );

    const encodedCallData = this.getEncodedCallData(
      target,
      value,
      callData,
      this.contractType
    );

    const encodedMetaTx = this.encodeMetaTransactionToSign(
      encodedCallData,
      encodedReplayProtection,
      this.replayProtectionAuthority.getAddress(),
      contractAddr
    );

    const signature = await signer.signMessage(
      arrayify(keccak256(encodedMetaTx))
    );

    const params: ForwardParams = {
      hub: contractAddr,
      signer: signer.address,
      target: target,
      value: value.toString(),
      data: callData,
      replayProtection: encodedReplayProtection,
      replayProtectionAuthority: this.replayProtectionAuthority.getAddress(),
      chainId: this.chainID,
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
    // Get proxy account address
    let contractAddr = this.contract;

    // Proxy Account has a deploy function function.
    if (this.contractType === ContractType.PROXYHUB) {
      const proxyHub = new ProxyHubFactory(signer).attach(this.contract);
      const baseAddress = await proxyHub.baseAccount();

      contractAddr = MetaTxHandler.buildCreate2Address(
        proxyHub.address,
        signer.address,
        baseAddress
      );
    }

    const encodedReplayProtection = await this.replayProtectionAuthority.getEncodedReplayProtection(
      signer,
      contractAddr
    );

    const encodedMetaTx = this.encodeMetaTransactionToSign(
      initCode,
      encodedReplayProtection,
      this.replayProtectionAuthority.getAddress(),
      contractAddr
    );

    const signature = await signer.signMessage(
      arrayify(keccak256(encodedMetaTx))
    );

    const params: DeploymentParams = {
      hub: contractAddr,
      signer: signer.address,
      data: initCode,
      replayProtection: encodedReplayProtection,
      replayProtectionAuthority: this.replayProtectionAuthority.getAddress(),
      chainId: this.chainID,
      signature: signature,
    };

    return params;
  }

  /**
   * Computes the proxy contract account.
   * Thanks to _prestwich for his pseudocode, got it to work!
   * @param creatorAddress Creator of the clone contract (ProxyHub)
   * @param signersAddress Signer's address
   * @param cloneAddress Contract to clone address
   */
  public static buildCreate2Address(
    creatorAddress: string,
    signersAddress: string,
    cloneAddress: string
  ) {
    const saltHex = solidityKeccak256(["address"], [signersAddress]);
    const byteCodeHash = solidityKeccak256(
      ["bytes", "bytes20", "bytes"],
      [
        "0x3d602d80600a3d3981f3363d3d373d3d3d363d73",
        cloneAddress,
        "0x5af43d82803e903d91602b57fd5bf3",
      ]
    );

    return `0x${keccak256(
      `0x${["ff", creatorAddress, saltHex, byteCodeHash]
        .map((x) => x.replace(/0x/, ""))
        .join("")}`
    ).slice(-40)}`;
  }
}
