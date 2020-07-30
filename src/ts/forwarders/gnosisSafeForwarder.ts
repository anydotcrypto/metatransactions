import {
  defaultAbiCoder,
  solidityKeccak256,
  keccak256,
  BigNumberish,
  arrayify,
  splitSignature,
  hexlify,
  concat,
  BigNumber,
} from "ethers/utils";
import { GnosisReplayProtection } from "../replayProtection/gnosisNonce";
import { MultiSender } from "../batch/multiSend";
import { MinimalTx, CallType, Forwarder } from "./forwarder";
import { Create2Options, getCreate2Address } from "ethers/utils/address";
import { ChainID } from "./forwarderFactory";
import {
  ProxyAccountCallData,
  ProxyAccountDeployCallData,
  RevertableProxyAccountCallData,
  RevertableProxyAccountDeployCallData,
} from "./proxyAccountFowarder";
import {
  GNOSIS_SAFE_ADDRESS,
  PROXY_FACTORY_ADDRESS,
  MULTI_SEND_ADDRESS,
} from "../../deployment/addresses";
import { Signer } from "ethers";
import {
  GnosisProxyFactory,
  GnosisSafeFactory,
  GnosisSafe,
  ProxyFactory,
  ProxyFactoryFactory,
} from "../../typedContracts";
import { AddressZero } from "ethers/constants";
import { WalletForwarder } from "./walletForwarder";

/**
 * Tools for interacting with the gnosis safe contract wallet.
 * https://github.com/gnosis/safe-contracts
 */
export class GnosisSafeForwarder
  extends Forwarder<
    ProxyAccountCallData,
    ProxyAccountDeployCallData,
    RevertableProxyAccountCallData,
    RevertableProxyAccountDeployCallData
  >
  implements WalletForwarder {
  private readonly proxyFactory: ProxyFactory;
  private readonly gnosisSafeMaster: GnosisSafe;
  private readonly TYPEHASH: string =
    "0xbb8310d486368db6bd6f849402fdd73ad53d316b5a4b2644ad6efe0f941286d8";

  /**
   * All meta-transactions are sent via a Gnosis Safe walletr contract.
   * @param chainID Chain ID
   * @param signer Signer's wallet
   * @param signerAddress Signer's address
   */
  constructor(
    chainID: ChainID,
    signer: Signer,
    signerAddress: string,
    options?: {
      proxyFactoryAddress?: string;
      gnosisSafeMaster?: string;
    }
  ) {
    super(
      chainID,
      signer,
      GnosisSafeForwarder.getAddress(signerAddress, chainID, {
        proxyFactoryAddress:
          options?.proxyFactoryAddress || PROXY_FACTORY_ADDRESS,
        gnosisSafeMasterAddress:
          options?.gnosisSafeMaster || GNOSIS_SAFE_ADDRESS,
      }),
      new GnosisReplayProtection(
        signer,
        GnosisSafeForwarder.getAddress(signerAddress, chainID, {
          proxyFactoryAddress:
            options?.proxyFactoryAddress || PROXY_FACTORY_ADDRESS,
          gnosisSafeMasterAddress:
            options?.gnosisSafeMaster || GNOSIS_SAFE_ADDRESS,
        })
      )
    );
    this.proxyFactory = new ProxyFactoryFactory(signer).attach(
      options?.proxyFactoryAddress || PROXY_FACTORY_ADDRESS
    );
    this.gnosisSafeMaster = new GnosisSafeFactory(signer).attach(
      options?.gnosisSafeMaster || GNOSIS_SAFE_ADDRESS
    );
  }

  public decodeTx(
    data: string
  ): {
    to: string;
    value: BigNumber;
    data: string;
    operation: CallType;
    safeTxGas: BigNumber;
    baseGas: BigNumber;
    gasPrice: BigNumber;
    gasToken: string;
    refundReceiver: string;
    signatures: string;
  } {
    const parsedTransaction = this.gnosisSafeMaster.interface.parseTransaction({
      data,
    });

    const functionArgs: {
      to: string;
      value: BigNumber;
      data: string;
      operation: CallType;
      safeTxGas: BigNumber;
      baseGas: BigNumber;
      gasPrice: BigNumber;
      gasToken: string;
      refundReceiver: string;
      signatures: string;
    } = {
      to: parsedTransaction.args[0],
      value: parsedTransaction.args[1],
      data: parsedTransaction.args[2],
      operation: parsedTransaction.args[3],
      safeTxGas: parsedTransaction.args[4],
      baseGas: parsedTransaction.args[5],
      gasPrice: parsedTransaction.args[6],
      gasToken: parsedTransaction.args[7],
      refundReceiver: parsedTransaction.args[8],
      signatures: parsedTransaction.args[9],
    };

    return functionArgs;
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

  protected async signAndEncodeMetaTransaction(
    data: ProxyAccountCallData
  ): Promise<MinimalTx> {
    const dataWithDefaults = this.defaultCallData(data);

    const replayProtection = await this.replayProtectionAuthority.getEncodedReplayProtection();
    const signature = await this.hashAndSign(
      dataWithDefaults,
      replayProtection
    );

    const encoded = this.gnosisSafeMaster.interface.functions.execTransaction.encode(
      [
        dataWithDefaults.to,
        dataWithDefaults.value,
        dataWithDefaults.data,
        dataWithDefaults.callType,
        0,
        0,
        0,
        AddressZero,
        AddressZero,
        signature,
      ]
    );

    return {
      data: encoded,
      to: this.address,
    };
  }

  protected async signAndEncodeBatchMetaTransaction(
    dataList: RevertableProxyAccountCallData[]
  ): Promise<MinimalTx> {
    // this data should be added to a batch
    // get the defaults for this list
    const withDefaults = dataList.map((d) => this.defaultRevertableCallData(d));

    const minimalTx = new MultiSender(MULTI_SEND_ADDRESS).batch(withDefaults);
    const callData = {
      to: minimalTx.to,
      data: minimalTx.data,
      value: 0,
      callType: CallType.DELEGATE,
    };

    return await this.signAndEncodeMetaTransaction(callData);
  }

  public async hashAndSign(
    callData: Required<ProxyAccountCallData>,
    replayProtection: string
  ) {
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
        callData.to,
        callData.value,
        keccak256(callData.data),
        callData.callType,
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

    // It can either be 27 or 28.
    // Gnosis safe expects it as 31 or 32 (for prefixed messages)
    const recParam = splitSig.v === 27 ? "0x1f" : "0x20";
    const jointSignature = hexlify(concat([splitSig.r, splitSig.s, recParam]));

    return jointSignature;
  }

  /**
   * Returns the encoded calldata for creating a proxy contract
   * No need for ForwardParams as no signature is required in ProxyAccountDeployer
   * @returns The proxy deployer address and the calldata for creating proxy account
   * @throws If the proxy account already exists
   */
  public async getWalletDeployTransaction(): Promise<MinimalTx> {
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

    const salt = keccak256(defaultAbiCoder.encode(["uint"], [this.chainID]));

    const callData = this.proxyFactory.interface.functions.createProxyWithNonce.encode(
      [this.gnosisSafeMaster.address, setup, salt]
    );

    return {
      to: this.proxyFactory.address,
      data: callData,
    };
  }

  /**
   * Compute the address of a contract from the deployer and signer
   * @param creatorAddress Creator of the clone contract (ProxyAccountDeployer)
   * @param signersAddress Signer's address
   * @param cloneAddress Contract to clone address
   */
  public static getAddress(
    signersAddress: string,
    chainId: number,
    options?: {
      gnosisSafeMasterAddress?: string;
      proxyFactoryAddress?: string;
    }
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

    const deployTx = new GnosisProxyFactory().getDeployTransaction(
      options?.gnosisSafeMasterAddress || GNOSIS_SAFE_ADDRESS
    );

    const salt = keccak256(defaultAbiCoder.encode(["uint"], [chainId]));

    const create2Options: Create2Options = {
      from: options?.proxyFactoryAddress || PROXY_FACTORY_ADDRESS,
      salt: solidityKeccak256(["bytes32", "uint"], [keccak256(setup), salt]),
      initCode: deployTx.data,
    };

    return getCreate2Address(create2Options);
  }

  /**
   * Computes the deterministic address for a contract that was
   * deployed by this forwarder
   * @param initData Initialisation code for the contract
   * @param extraData One-time use value.
   */
  public computeAddressForDeployedContract(
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
