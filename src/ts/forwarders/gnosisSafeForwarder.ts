import {
  defaultAbiCoder,
  solidityKeccak256,
  keccak256,
  BigNumberish,
  arrayify,
  splitSignature,
  hexlify,
  concat,
} from "ethers/utils";
import {
  ChainID,
  ProxyAccountCallData,
  ProxyAccountDeployCallData,
  RevertableProxyAccountCallData,
  RevertableProxyAccountDeployCallData,
  Proxy1Factory,
  MultiSender,
  GnosisReplayProtection,
} from "../..";
import { Forwarder, MinimalTx, CallType } from "./forwarder";
import { Create2Options, getCreate2Address } from "ethers/utils/address";
import {
  GNOSIS_SAFE_ADDRESS,
  PROXY_FACTORY_ADDRESS,
  MULTI_SEND_ADDRESS,
} from "../../deployment/addresses";
import { Signer, Wallet } from "ethers";
import { ProxyFactoryFactory } from "../../gnosisTypedContracts/ProxyFactoryFactory";
import { ProxyFactory } from "../../gnosisTypedContracts/ProxyFactory";
import { GnosisSafe } from "../../gnosisTypedContracts/GnosisSafe";
import { GnosisSafeFactory } from "../../gnosisTypedContracts/GnosisSafeFactory";
import { AddressZero } from "ethers/constants";

/**
 * A single library for approving meta-transactions and its associated
 * replay protection. All meta-transactions are sent via proxy contracts.
 */
export class GnosisSafeForwarder extends Forwarder<
  ProxyAccountCallData,
  ProxyAccountDeployCallData,
  RevertableProxyAccountCallData,
  RevertableProxyAccountDeployCallData
> {
  private proxyFactory: ProxyFactory;
  private gnosisSafeMaster: GnosisSafe;
  private TYPEHASH: string =
    "0xbb8310d486368db6bd6f849402fdd73ad53d316b5a4b2644ad6efe0f941286d8";
  /**
   * All meta-transactions are sent via a Gnosis Safe walletr contract.
   * @param chainID Chain ID
   * @param proxyFactoryAddress Address of the Proxy Factory (responsible for deploying proxy)
   * @param signer Signer's wallet
   * @param proxyAddress Proxy contract
   */
  constructor(
    chainID: ChainID,
    proxyFactoryAddress: string,
    signer: Signer,
    address: string
  ) {
    super(
      chainID,
      signer,
      address,
      new GnosisReplayProtection(signer, address)
    );
    this.proxyFactory = new ProxyFactoryFactory(signer).attach(
      proxyFactoryAddress
    );
    this.gnosisSafeMaster = new GnosisSafeFactory(signer).attach(
      GNOSIS_SAFE_ADDRESS
    );
  }

  private defaultCallData(
    data: ProxyAccountCallData
  ): Required<ProxyAccountCallData> {
    return {
      to: data.to,
      value: data.value ? data.value : 0,
      data: data.data ? data.data : "0x",
      callType: data.callType ? data.callType : CallType.CALL,
    };
  }

  private defaultRevertableCallData(
    data: RevertableProxyAccountCallData
  ): Required<RevertableProxyAccountCallData> {
    return {
      ...this.defaultCallData(data),
      revertOnFail: data.revertOnFail ? data.revertOnFail : false,
    };
  }

  protected deployDataToCallData(
    initCode: string,
    extraData: string,
    value: BigNumberish
  ): ProxyAccountCallData {
    return {
      ...this.encodeForDeploy(initCode, extraData, value),
      value: "0",
      callType: CallType.DELEGATE,
    };
  }

  protected deployDataToBatchCallData(
    initCode: string,
    extraData: string,
    value: BigNumberish,
    revertOnFail?: boolean
  ): RevertableProxyAccountCallData {
    return {
      ...this.encodeForDeploy(initCode, extraData, value),
      value: "0",
      callType: CallType.DELEGATE,
      revertOnFail: revertOnFail || false,
    };
  }

  public decodeTx(data: string) {
    const parsedTransaction = this.gnosisSafeMaster.interface.parseTransaction({
      data,
    });
    const functionArgs: {
      _metaTx: Required<ProxyAccountCallData>;
      _replayProtection: string;
      _replayProtectionAuthority: string;
      _signature: string;
    } = {
      _metaTx: {
        to: parsedTransaction.args[0],
        value: parsedTransaction.args[1],
        data: parsedTransaction.args[2],
        callType: parsedTransaction.args[3],
      },
      _replayProtection: "-1", // TODO: Nonce signed, but not sent.
      _replayProtectionAuthority: this.address, // Technically, proxy address has the nonce information.
      _signature: parsedTransaction.args[9],
    };
    return functionArgs;
  }

  public decodeBatchTx(data: string) {
    const decodedTx = this.decodeTx(data);

    const multiSendList = new MultiSender(MULTI_SEND_ADDRESS).decodeBatch(
      decodedTx._metaTx.data
    );

    const metaTxList: Required<RevertableProxyAccountCallData>[] = [];
    for (let i = 0; i < multiSendList.length; i++) {
      const metaTx = this.defaultRevertableCallData(multiSendList[i]);
      metaTxList.push(metaTx);
    }

    const functionArgs: {
      _metaTxList: Required<RevertableProxyAccountCallData>[];
      _replayProtection: string;
      _replayProtectionAuthority: string;
      _signature: string;
    } = {
      _metaTxList: metaTxList,
      _replayProtection: decodedTx._replayProtection, // Cannot fetch, but Forwarder.ts requires us to return it.
      _replayProtectionAuthority: decodedTx._replayProtectionAuthority, // Proxy account contract stores nonce
      _signature: decodedTx._signature,
    };
    return functionArgs;
  }

  protected encodeCallData(data: ProxyAccountCallData): string {
    const defaulted = this.defaultCallData(data);

    return defaultAbiCoder.encode(
      ["uint", "address", "uint", "bytes"],
      [defaulted.callType, defaulted.to, defaulted.value, defaulted.data]
    );
  }

  // Overrides the encodeAndSignParams from the Forwarder class.
  public async encodeAndSignParams(
    callData: ProxyAccountCallData | RevertableProxyAccountCallData,
    replayProtection: string,
    replayProtectionAuthority: string
  ) {
    let proxyData: ProxyAccountCallData;

    if (Array.isArray(callData)) {
      const minimalTx = new MultiSender().batch(callData);

      proxyData = {
        to: minimalTx.to,
        data: minimalTx.data,
        value: 0,
        callType: CallType.DELEGATE,
      };
    } else {
      proxyData = this.defaultCallData(callData);
    }

    const nonce = defaultAbiCoder.decode(["uint"], replayProtection);
    const encodedData = defaultAbiCoder.encode(
      [
        "bytes32",
        "address",
        "uint",
        "bytes32",
        "uint",
        "uint",
        "uint",
        "uint",
        "address",
        "address",
        "uint",
      ],
      [
        this.TYPEHASH,
        proxyData.to,
        proxyData.value!,
        keccak256(proxyData.data!),
        proxyData.callType,
        0,
        0,
        0,
        AddressZero,
        AddressZero,
        nonce,
      ]
    );

    const txHash = keccak256(encodedData);

    const domainSeparator = keccak256(
      defaultAbiCoder.encode(
        ["bytes32", "address"],
        [
          "0x035aff83d86937d35b32e04f0ddc6ff469290eef2f1b692d8a815c89404d4749",
          this.address,
        ]
      )
    );

    const txHashData = solidityKeccak256(
      ["bytes1", "bytes1", "bytes32", "bytes32"],
      ["0x19", "0x01", domainSeparator, txHash]
    );

    const signature = await this.signer.signMessage(arrayify(txHashData));
    const splitSig = splitSignature(signature);

    let recParam;

    if (splitSig.v! == 27) {
      recParam = "0x1f";
    } else {
      recParam = "0x20";
    }
    const jointSignature = hexlify(concat([splitSig.r, splitSig.s, recParam]));

    const encodedTx = await this.encodeTx(
      proxyData,
      "0x",
      AddressZero,
      jointSignature
    );

    return {
      encodedTx,
      signature: jointSignature,
    };
  }
  protected async encodeTx(
    data: ProxyAccountCallData,
    replayProtection: string,
    replayProtectionAuthority: string,
    signature: string
  ): Promise<string> {
    const gnosisSafeMaster = new GnosisSafeFactory(this.signer).attach(
      GNOSIS_SAFE_ADDRESS
    );

    return gnosisSafeMaster.interface.functions.execTransaction.encode([
      data.to,
      data.value!,
      data.data!,
      data.callType!,
      0,
      0,
      0,
      AddressZero,
      AddressZero,
      signature,
    ]);
  }

  protected encodeBatchCallData(
    txBatch: RevertableProxyAccountCallData[]
  ): string {
    const metaTxList = txBatch.map((b) => this.defaultRevertableCallData(b));
    return new MultiSender(MULTI_SEND_ADDRESS).batch(metaTxList).data;
  }

  // We have not implemented encodeBatchTx as Gnosis Safe does not support it natively.
  // Instead we just delegatecall into the MultiSend class and this is implemented in
  // .encodeBatchCallData().
  protected async encodeBatchTx(
    txBatch: RevertableProxyAccountCallData[],
    replayProtection: string,
    replayProtectionAuthority: string,
    signature: string
  ): Promise<string> {
    throw new Error("Not implemented");
  }

  /**
   * Checks if the ProxyContract is already deployed.
   * @returns TRUE if deployed, FALSE if not deployed.
   */
  public async isContractDeployed(): Promise<boolean> {
    const code = await this.signer.provider!.getCode(this.address);
    // Geth will return '0x', and ganache-core v2.2.1 will return '0x0'
    const codeIsEmpty = !code || code === "0x" || code === "0x0";
    return !codeIsEmpty;
  }

  /**
   * Returns the encoded calldata for creating a proxy contract
   * No need for ForwardParams as no signature is required in ProxyAccountDeployer
   * @returns The proxy deployer address and the calldata for creating proxy account
   * @throws If the proxy account already exists
   */
  public async createProxyContract(): Promise<MinimalTx> {
    const setup = this.gnosisSafeMaster.interface.functions.setup.encode([
      [await this.signer.getAddress()],
      1,
      AddressZero,
      "0x",
      AddressZero,
      AddressZero,
      0,
      AddressZero,
    ]);

    const salt = keccak256("0x123");

    const callData = this.proxyFactory.interface.functions.createProxyWithNonce.encode(
      [this.gnosisSafeMaster.address, setup, salt]
    );

    return {
      to: this.proxyFactory.address,
      data: callData,
    };
  }

  /**
   * Builds the proxy contract address.
   * @param creatorAddress Creator of the clone contract (ProxyAccountDeployer)
   * @param signersAddress Signer's address
   * @param cloneAddress Contract to clone address
   */
  public static buildProxyAccountAddress(
    wallet: Wallet,
    signersAddress: string
  ): string {
    const gnosisSafeInterface = new GnosisSafeFactory()
      .interface as GnosisSafe["interface"];

    const setup = gnosisSafeInterface.functions.setup.encode([
      [signersAddress],
      1,
      AddressZero,
      "0x",
      AddressZero,
      AddressZero,
      0,
      AddressZero,
    ]);

    const salt = keccak256("0x123");

    const deployTx = new Proxy1Factory(wallet).getDeployTransaction(
      GNOSIS_SAFE_ADDRESS
    );

    const create2Options: Create2Options = {
      from: PROXY_FACTORY_ADDRESS,
      salt: solidityKeccak256(["bytes32", "uint"], [keccak256(setup), salt]),
      initCode: deployTx.data,
    };
    return getCreate2Address(create2Options);
  }

  /**
   * Computes the deterministic address for a deployed contract
   * @param initData Initialisation code for the contract
   * @param extraData One-time use value.
   */
  public buildDeployedContractAddress(
    initData: string,
    extraData: string
  ): string {
    const byteCodeHash = solidityKeccak256(["bytes"], [initData]);
    const salt = keccak256(extraData);

    const options: Create2Options = {
      from: this.address,
      salt: salt,
      initCodeHash: byteCodeHash,
    };

    return getCreate2Address(options);
  }
}
