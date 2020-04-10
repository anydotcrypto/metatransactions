import "mocha";
import * as chai from "chai";
import { solidity, loadFixture } from "ethereum-waffle";
import { keccak256, arrayify, defaultAbiCoder, BigNumber } from "ethers/utils";
import Doppelganger from "ethereum-doppelganger";
import { fnIt } from "@pisa-research/test-utils";
import { IReplayProtectionJson, ContractHubFactory, BitFlipNonceStoreFactory, MsgSenderExampleFactory, ContractHub, ContractAccountFactory } from "../../src";
import { Provider } from "ethers/providers";
import { Wallet } from "ethers/wallet";
import { signMetaTransaction, updateHub, signMetaDeployment } from "./hub-utils";
const expect = chai.expect;
chai.use(solidity);

let dummyAccount: ContractHub;
type contractHubFunctions = typeof dummyAccount.functions;

// const emptyAddress = "0x635B4764D1939DfAcD3a8014726159abC277BecC";

export interface ForwardParams {
    contractHub: string;
    target: string;
    value: string;
    data: string;
    replayProtection: string;
    replayProtectionAuthority: string;
    chainId: number;
}

export const constructDigest = (params: ForwardParams) => {
    return arrayify(
        keccak256(
            defaultAbiCoder.encode(
                ["address", "address", "uint", "bytes", "bytes", "address", "uint"],
                [params.contractHub, params.target, params.value, params.data, params.replayProtection, params.replayProtectionAuthority, params.chainId]
            )
        )
    );
};

async function createContractHub(provider: Provider, [admin, owner, sender]: Wallet[]) {
    const contractHubFactory = new ContractHubFactory(admin);
    const contractHubCreationTx = contractHubFactory.getDeployTransaction();

    const nonceStoreMock = new Doppelganger(IReplayProtectionJson.interface);
    await nonceStoreMock.deploy(admin);
    await nonceStoreMock.update.returns(true);
    await nonceStoreMock.updateFor.returns(true);

    const bitFlipNonceStoreFactory = new BitFlipNonceStoreFactory(admin);
    const bitFlipNonceStore = await bitFlipNonceStoreFactory.deploy();

    const contractHubCreation = await admin.sendTransaction(contractHubCreationTx);
    const result = await contractHubCreation.wait(1);

    const msgSenderFactory = new MsgSenderExampleFactory(admin);
    const msgSenderCon = await msgSenderFactory.deploy(result.contractAddress!);
    const contractHub = contractHubFactory.attach(result.contractAddress!);
    updateHub(contractHub);
    return { provider, contractHub, admin, owner, sender, msgSenderCon, nonceStoreMock, bitFlipNonceStore };
}

describe("ContractHubContract", () => {
    fnIt<contractHubFunctions>(
        (a) => a.createContractAccount,
        "create contract account with deterministic address",
        async () => {
            const { contractHub, sender } = await loadFixture(createContractHub);

            await contractHub.connect(sender).createContractAccount(sender.address);
            const contractAddress = await contractHub.connect(sender).accounts(sender.address);

            expect(contractAddress).to.eq("0xAcC70E67808E3AAEFa90077F3d92f80c90A7988E");
        }
    );

    fnIt<contractHubFunctions>(
        (a) => a.createContractAccount,
        "cannot re-create the same contract twice",
        async () => {
            const { contractHub, sender } = await loadFixture(createContractHub);

            await contractHub.connect(sender).createContractAccount(sender.address);

            const tx = contractHub.connect(sender).createContractAccount(sender.address);
            await expect(tx).to.be.reverted;
        }
    );

    fnIt<contractHubFunctions>(
        (a) => a.forward,
        "for contractAccount emits expected address",
        async () => {
            const { contractHub, owner, sender, msgSenderCon, nonceStoreMock } = await loadFixture(createContractHub);
            const msgSenderCall = msgSenderCon.interface.functions.test.encode([]);

            await contractHub.connect(sender).createContractAccount(owner.address);
            const contractAddress = await contractHub.connect(sender).accounts(owner.address);

            const params = await signMetaTransaction(owner, msgSenderCon.address, new BigNumber("0"), msgSenderCall);

            const tx = contractHub
                .connect(sender)
                .forward(params.target, params.value, params.data, params.replayProtection, params.replayProtectionAuthority, params.signature);

            await expect(tx).to.emit(msgSenderCon, msgSenderCon.interface.events.WhoIsSender.name).withArgs(contractAddress);
        }
    );

    fnIt<contractHubFunctions>(
        (a) => a.forward,
        "tries to target an existing contract account and fails",
        async () => {
            const { contractHub, owner, sender, msgSenderCon } = await loadFixture(createContractHub);

            const msgSenderCall = msgSenderCon.interface.functions.test.encode([]);

            // In this test, we'll call the contract account (loop in) and then callout to msgSenderCall
            await contractHub.connect(sender).createContractAccount(owner.address);
            const contractAddress = await contractHub.connect(sender).accounts(owner.address);
            const contractAccountFactory = new ContractAccountFactory(sender);
            const contractAccountCon = contractAccountFactory.attach(contractAddress);
            const contractAccountCall = contractAccountCon.interface.functions.acceptCommand.encode([msgSenderCon.address, 0, msgSenderCall]);

            const params = await signMetaTransaction(owner, contractHub.address, new BigNumber("0"), contractAccountCall);

            const tx = contractHub
                .connect(sender)
                .forward(params.target, params.value, params.data, params.replayProtection, params.replayProtectionAuthority, params.signature);

            await expect(tx).to.be.revertedWith("Forwarding call failed.");
        }
    );

    fnIt<contractHubFunctions>(
        (a) => a.deployContract,
        "deploys a contract via the contractHub",
        async () => {
            const { contractHub, owner, sender } = await loadFixture(createContractHub);

            const msgSenderFactory = new MsgSenderExampleFactory(owner);

            await contractHub.connect(sender).createContractAccount(owner.address);

            const initCode = msgSenderFactory.getDeployTransaction(contractHub.address).data! as string;

            // Deploy the contract using CREATE2
            const params = await signMetaDeployment(owner, initCode);
            await contractHub.connect(sender).deployContract(params.data, params.replayProtection, params.replayProtectionAuthority, params.signature);

            // Compute deterministic address
            const hByteCode = arrayify(keccak256(initCode));
            const encodeToSalt = defaultAbiCoder.encode(["address", "bytes"], [owner.address, params.replayProtection]);
            const salt = arrayify(keccak256(encodeToSalt));

            // Fetch the contract on-chain instance
            const msgSenderExampleAddress = await contractHub.connect(sender).computeAddress(salt, hByteCode);
            const msgSenderExampleCon = msgSenderFactory.attach(msgSenderExampleAddress);

            // Try executing a function - it should exist and work
            const tx = msgSenderExampleCon.connect(sender).test();
            await expect(tx).to.emit(msgSenderExampleCon, msgSenderExampleCon.interface.events.WhoIsSender.name).withArgs(sender.address);
        }
    );

    fnIt<contractHubFunctions>(
        (a) => a.deployContract,
        "deploy missing real init code and fails",
        async () => {
            const { contractHub, owner, sender } = await loadFixture(createContractHub);

            const msgSenderFactory = new MsgSenderExampleFactory(owner);

            await contractHub.connect(sender).createContractAccount(owner.address);

            // Doesn't like bytecode. Meh.
            const initCode = msgSenderFactory.bytecode;

            // Deploy the contract using CREATE2
            const params = await signMetaDeployment(owner, initCode);
            const deployed = contractHub
                .connect(sender)
                .deployContract(params.data, params.replayProtection, params.replayProtectionAuthority, params.signature);

            await expect(deployed).to.revertedWith("Create2: Failed on deploy");
        }
    );
});
