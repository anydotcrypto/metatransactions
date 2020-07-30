# Echo Example

We have put together a few examples on how to use the meta-transaction library. All examples focus on meta-deploying an Echo Contract and then sending a meta-transaction to broadcast a message.

## Install the packages

You will need node_modules to run the example:

```
pnpm i
```

If you want to make sure everything is set up:

```
npm run test
```

## Generate seed & wallet address

To run the example you will need a 12-word seed:

```
npm run generateSeed
```

This will print out a 12-word seed & an Ethereum Wallet:

```
Wallet address: 0xBEBb4F959679EaDB2fa848a1b96662F8b3BB0Bcf
12-word seed: matrix uncover caution action broken tone diary curtain manual similar call symbol
```

Use the 12-word seed to fill in the USER_MNEMONIC in `gnosis/echo.ts` and `proxyaccount/echo.ts`:

```
export const USER_MNEMONIC = "matrix uncover caution action broken tone diary curtain manual similar call symbol":
```

## Run examples

To run the examples:

```
npm run proxy-echo-example
npm run gnosis-echo-example
```

If all goes well, you will see for each script:

```
Wallet address: 0xAB8878261DC9d700aFC3f774a90eA75B1EC35d2F
Balance: 0.1
Do we need to deploy a proxy account? true
Deploy proxy contract: https://ropsten.etherscan.io/tx/0x38b1a677a602b55776fcaeb37284d05a9a4cb97c884229615cb7b77ea71e584b
Deploying echo contract to address 0xee83089E2bcfF5D6d5d193033250E3aa82453af8
Deploy echo contract: https://ropsten.etherscan.io/tx/0x41c813eb9c5ba7d1dd3cbbfbda2ac6a4118d94cf6dadcd73e8dfacd52bd92219
Sending our message to echo
Send echo broadcast: https://ropsten.etherscan.io/tx/0x360d48448ef5d5931cad4169cb1ce3fc6ba952cf3ff1048fd3c5bc9e752d228e
Message in Echo Contract: any.sender is nice
```

Well done! And now appreciate how simple the example code is :)
