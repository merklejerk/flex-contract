[![build status](https://travis-ci.org/merklejerk/flex-contract.svg?branch=master)](https://travis-ci.org/merklejerk/flex-contract)
[![npm package](https://badge.fury.io/js/flex-contract.svg)](https://www.npmjs.com/package/flex-contract)

# flex-contract
A modern, flexible Ethereum smart contract abstraction that:

- Requires minimal configuration to get going on all networks (no provider necessary).
- Can sign and send transactions from arbitrary wallets (private keys).
- Can decode internal events (transaction events raised in other contracts).
- Facilitates easy event filtering and monitoring.
- Provides separate promises for transaction hashes, receipts, and confirmations.
- Automatically calculates gas and gas price for transactions in a configurable manner.
- Automatically resolves ENS addresses across all inputs.
- Experimental ABIEncoderV2 support.

#### Flex-Ether
If you want a simple library for working with more general (ether) transactions,
check out the [flex-ether package](https://github.com/merklejerk/flex-ether),
upon which this library is based.

## Installation
```bash
npm install flex-contract
# or
yarn install flex-contract
```

## Preview

```js
const FlexContract = require('flex-contract');
// May be a plain ABI or a truffle artifact.
const ABI = require('./MyContract.ABI.json');
// Should be the hex-encoded binary output of solc/truffle.
const BYTECODE = require('./MyContract.bytecode.bin');
// Previously deployed contract address. Can also be an ENS address.
const DEPLOYED_AT = '0xf6fb5b73987d6d9a139e23bab97be6fc89e0dcd1';
// A self-signing wallet key for transactions.
const PRIVATE_KEY = '0xb3734ec890893585330c71ece72afb05058192b6be47bee2b99714e6bb5696ab';

// Define a contract interface on the mainnet.
let contract = new FlexContract(ABI);
// Deploy it, signed by an private key.
const tx = contract.new({key: PRIVATE_KEY, bytecode: BYTECODE}).send();
// Wait for the transaction hash.
await tx.txId;
// Wait for the receipt, you can also just wait on the `tx` object itself.
await tx.receipt;
// Wait for the receipt after 3 confirmations.
await tx.confirmed(3);
// Call a constant function and wait for the result(s).
await contract.myConstantFn().call();
// Make a transaction call to the contract, signed by an
// private key, and wait for the receipt.
let receipt = await contract.myTransactionFn('1234').send({ key: PRIVATE_KEY });
// Find some transaction events in the receipt.
let events = receipt.findEvents('MyEvent');
// Find all contract events named 'MyEvent' from the last 16 blocks.
events = await contract.MyEvent().since({ fromBlock: -16 });
// Track events as they happen.
const watcher = contract.MyEvent().watch();
watcher.on('data', event => {
 // Handle event.
});
```

## User Guide
- [Creating a flex contract](#creating-a-flex-contract)
- [Calling contract functions](#calling-contract-functions)
- [Estimating gas](#estimating-gas)
- [Making read-only calls](#making-read-only-calls)
- [Making transactions](#making-transactions)
- [Deploying a new contract instance](#deploying-a-new-contract-instance)
- [Getting encoded call data](#getting-encoded-call-data)
- [Receipt events](#receipt-events)
- [Past events](#past-events)
- [Live events](#live-events)
- [Encoding/Decoding Rules](#encodingdecoding-rules)
- [ENS addresses](#ens-addresses)
- [Cloning](#cloning)
- [Instance Properties](#instance-properties)

### Creating a flex contract
The only requirement for creating an instance is the ABI, which can be a plain
ABI outputted by [solc](https://github.com/ethereum/solidity), or a
Truffle artifact produced by the [truffle suite](https://truffleframework.com/).

By default, the instance will create an [Infura](https://infura.io) provider to
talk to the main network. You can modify this behavior with the options
`network`, `infuraKey`, `web3`, `eth`, `provider`, or `providerURI`.

Some options can be overridden in method calls.

```js
contract = new FlexContract(
   // Contract ABI object. May also be a truffle artifact.
   ABI: object | Array,
   // Deployed address of contract. May be an ENS address (e.g., 'ethereum.eth').
   // May omitted.
   address: string,
   // Options object. May be omitted.
   {
      // Network to use with Infura provider.
      // May be 'main', 'ropsten', 'rinkeby', or 'kovan'.
      // Defaults to 'main'
      network: string,
      // Your Infura project ID, if not passing a custom provider.
      infuraKey: string,
      // Whether to use a websocket connection instead of an HTTPS connection
      // when using Infura.
      ws: boolean,
      // Connect to an existing provider at a URI
      // (e.g., http://localhost:8545 or https://mainnet.infura.io/v3/PROJECT_ID).
      // The 'net' option is required is using an IPC path.
      providerURI: string,
      // net instance, from require('net'), if using IPC path in providerURI
      net: object,
      // Use a custom provider instance (e.g., web3.currentProvider for metamask).
      // Overrides all provider options.
      provider: object,
      // Use a custom web3 instance (that will be wrapped in a FlexEther).
      // Overrides all provider options.
      web3: object,
      // Use a custom FlexEther (web3 wrapper) instance.
      // Overrides all provider options.
      // See https://github.com/merklejerk/flex-ether
      eth: FlexEther,
      // Hex-encoded string output of solc --bin.
      // If the ABI passed as the first argument is a truffle artifact,
      // the bytecode will already be defined.
      bytecode: string,
      // Fractional bonus to apply to gas price when making transactions.
      // 0.01 = +1%. May be negative to under-price.
      // Defaults to -0.005.
      // Can be overridden in method calls.
      gasPriceBonus: string,
      // Fractional bonus to apply to gas limit estimates when making transactions.
      // 0.01 = +1%. May be negative, but probably not a good idea.
      // Defaults to 0.66
      // Can be overridden in method calls.
      gasBonus: string
   });
```

### Calling contract functions
The contract instance is automatically populated with the contract functions. Arguments can be passed in positionally or by name through a single dictionary object:

```js
const contract = new FlexContract(ABI, DEPLOYED_ADDRESS);
// Create a call object to `myContractFn(uint256 a, bytes32 b)`
// on the contract with positional arguments.
const call1 = contract.myContractFn(
    1337,
    '0xebca483a47b9ef4817ecf0b6d326833020a1e21ba067a25bf089e47ba634f87c',
);
// Create a call object to `myContractFn(uint256 a, bytes32 b)`
// on the contract with named arguments.
const call2 = contract.myContractFn({
    a: 1337,
    b: `0xebca483a47b9ef4817ecf0b6d326833020a1e21ba067a25bf089e47ba634f87c`
});
```

Calling the function will return a bound function call object, which allows you to do 3 things:

- `gas()`: Estimate the gas cost of the function call.
- `call()`: Simulate a call to the function, *without* modifying the blockchain state. This is the only way to get the return value of a contract function.
- `send()`: Send the call as a transaction, which modifies the blockchain state.

See [Encoding/Decoding Rules](#encodingdecoding-rules) for information on how function arguments and return values are encoded and decoded.

### Estimating gas
Calling `gas()` on a bound function call will simulate the call and estimate the gas used.

##### Example
```js
// Estimate the gas used by calling `myContractFn()`. This resolves to a single
// `number`.
const gasUsed = await contract.myContractFn(...args).gas(/* opts */);
```

##### Options
`gas()` accepts a single options object with the following optional fields:
```js
{
  // Address of caller. May be an ENS address.
  // Defaults to the provider's default account.
  from: string,
  // Hex-encoded private key.
  // Makes the call from the address derived from this private key.
  // Overrides the `from` option.
  key: string,
  // Address of contract to call. May be an ENS address.
  // Defaults to contract.address.
  address: string,
  // Amount of ether (in wei) to send with the call.
  // Can be a hex or base-10 string.
  value: string,
  // Make the call against the blockchain's state at a specific block number.
  // Can be a previously mined block number, a negative number, or the string
  // 'latest'.
  // If the number is negative, it represents a backwards offset from the
  // last block mined, where -1 is the last block mined, -2 is the second to
  // last, etc.
  // Defaults to -1.
  block: string,
  // Override the generated (hex) call data to be sent.
  data: string,
}
```

### Making read-only calls
Calling `call()` on a bound function call will simulate the function call without modifying the blockchain state. This is the only way to get the return value from a contract function, as transactions resolve to receipts, not return values.

##### Example
```js
// Simulate a call to `myContractFn()`, which resolves to its return value(s).
const result = await contract.myContractFn(...args).call(/* opts */);
```

##### Options
`call()` can accept a single options object with the following optional fields:
```js
{
  // Address of caller. May be an ENS address.
  // Defaults to the provider's default account.
  from: string,
  // Hex-encoded private key.
  // Makes the call from the address derived from this private key.
  // Overrides the `from` option.
  key: string,
  // Address of contract to call. May be an ENS address.
  // Defaults to contract.address.
  address: string,
  // Amount of ether (in wei) to send with the call.
  // Can be a hex or base-10 string.
  value: string,
  // Make the call against the blockchain's state at a specific block number.
  // Can be a previously mined block number, a negative number, or the string
  // 'latest'.
  // If the number is negative, it represents a backwards offset from the
  // last block mined, where -1 is the last block mined, -2 is the second to
  // last, etc.
  // Defaults to -1.
  block: string,
  // The gas limit of the call.
  gas: number,
  // Override the generated (hex) call data to be sent.
  data: string,
  // geth `eth_call` state overrides object.
  // See https://geth.ethereum.org/docs/rpc/ns-eth
  overrides: object,
}
```

### Making transactions
To actually modify the blockchain, you can execute a contract function call as a transaction by calling `send()` on a bound function object. This resolves to a [receipt](https://web3js.readthedocs.io/en/1.0/web3-eth.html#eth-gettransactionreceipt-return) object once the transaction is successfully mined.

`send()` returns an augmented `Promise` object with the following fields:
- `txId`: A `Promise` that resolves once the transaction hash of the call is available.
- `receipt`: A `Promise` that resolves to a receipt once the transaction is mined. Same as waiting on the container `Promise` object.
- `confirmed(count)`: A `Promise ` that rsolves to a receipt once the transaction is mind and has been confirmed by `count` blocks.

##### Examples
```js
// Execute a call to `myContractFn()`, which resolves to a receipt when
// successfully mined.
const receipt = await contract.myContractFn(...args).send(/* opts */);
// This also resolves to a transaction receipt.
const receipt = await contract.myContractFn(...args).send(/* opts */).receipt;
// This resolves to the transaction hash once it's available.
const txHash = await contract.myContractFn(...args).send(/* opts */).txId;
// This resolves to the receipt after 4 confirmations.
const receipt = await contract.myContractFn(...args).send(/* opts */).confirmed(4);
```

##### Options
`send()` can accept a single options object with the following optional fields:
```js
{
  // Address of caller. May be an ENS address.
  // Defaults to the provider's default account.
  from: string,
  // Hex-encoded private key.
  // Makes the call from the address derived from this private key.
  // Overrides the `from` option.
  key: string,
  // Address of contract to call. May be an ENS address.
  // Defaults to contract.address.
  address: string,
  // Amount of ether (in wei) to send with the call.
  // Can be a hex or base-10 string.
  value: string,
  // The gas limit of the call.
  gas: number,
  // Gas price to use, as a hex or base-10 string, in wei.
  // If not specified, it will be calculated from network gas price with bonus.
  gasPrice: string,
  // Bonus to apply to gas price calculations.
  // Should be a positive or negative string, where 0.01 = +1%.
  // If omitted, `contract.gasPriceBonus` will be used.
  gasPriceBonus: string,
  // Bonus to apply to gas limit calculations.
  // Should be a positive or negative string, where 0.01 = +1%.
  // If omitted, `contract.gasBonus` will be used.
  gasBonus: string,
  // Override the generated (hex) call data to be sent.
  data: string,
```

### Deploying a new contract instance
A contract can be deployed via `new()` which, like normal function calls, returns a bound function object with `gas()`, `call()`, and `send()` functions.

##### Example
```js
const FlexContract = require('flex-contract');
const ABI = require('./MyContract.ABI.json');
// Should be the hex-encoded binary output of solc/truffle.
const BYTECODE = require('./MyContract.bytecode.bin');

// Create a contract with bytecode data.
const contract = FlexContract(ABI, {bytecode: BYTECODE});

// Deploy a new instance of the contract, passing two positional arguments
// to the constructor, signed by default provider account and wait for the receipt.
const receipt = await contract.new(arg1, arg2).send();
// contract.address is now set to the deployed address.
contract.address; // '0x059AFFF592bCF0CD2dDaAF83CeC2dbeEDA6f71D5'
// receipt also has deployed contract address.
receipt.address; // '0x059AFFF592bCF0CD2dDaAF83CeC2dbeEDA6f71D5'
```

### Getting encoded call data
Calling `encode()` on a bound function call will return the encoded call data.

##### Example
```js
// Return the encoded call data to `myContractFn()`.
const encoded = await contract.myContractFn(...args).encode(/* opts */);
```

### Receipt Events
Receipts resolved from transaction calls follow the format of web3
[transaction receipts](https://web3js.readthedocs.io/en/1.0/web3-eth.html#eth-gettransactionreceipt-return),
augmented with a few extra fields:

- `events`: array of parsed event objects.
- `findEvent(name, args)`: method to find the first event matching a provided arguments object.
- `findEvents(name, args)`: method to find all events matching a provided arguments object.

##### The Event object
Event objects follow the format:
```javascript
{
   // Transaction hash of the transaction that triggered it.
   transactionHash: '0x1234...',
   // Block number of the block it occured in.
   blockNumber: 1234,
   // Index against all other logs raised in the transaction.
   logIndex: 1234,
   // Address of the contract where the event was raised.
   address: '0x1234...',
   // Name of the event.
   name: 'MyEventName',
   // Arguments of the event.
   // Keys are for both the positional index of the argument and its name.
   args: {
      '0': FIRST_VALUE,
      'FIRST_VALUE_NAME': FIRST_VALUE,
      '1': SECOND_VALUE,
      'SECOND_VALUE_NAME': SECOND_VALUE,
      ...
   }
}
```

##### Searching events
```javascript
const receipt = await contract.someTransactionFn(...args).send();
// List events.
receipt.events; // [{name:..., args:...}, ... etc.]
// Find an event named 'MyEvent' matching certain argument values.
// Returns one event.
receipt.findEvent('MyEvent', {argName0: argValue0, ...});
// Find all events named 'MyEvent' matching certain argument values.
// Returns a list of events.
receipt.findEvents('MyEvent', {argName0: argValue0, ...});

```

##### Decoding internal events
Internal events are events that are raised in other contracts during a transaction. The library will attempt to decode these events only if a flex-contract had been previously instantiated to that address, from construction, deployment, or by explicitly setting a contract's address field.

### Past Events
Past events can be retrieved by calling a method on the contract instance sharing the same name as the event, then calling `since()` on the returned object. Arguments passed into the method will filter results to only those whose arguments match. You may pass `null` for arguments that should match any value. Event objects follow the format defined in
[receipt objects](#the-event-object).

The range of blocks to search for events can be set through the `fromBlock` and `toBlock` options. Possible values are all mined block numbers. Negative numbers can also be used to specify a backwards offset from the last block, where `-1` is the last block, `-2` is the second to last block, and so on.

##### Examples
```js
// Get all events named 'MyEvent', which takes two arguments, that occurred in
// the last block. `events` is an array of event objects.
let events = await contract.MyEvent(null, null).since();
// Get all events named 'MyEvent' with the first argument matching `1234` that
// occurred in the last 10 blocks.
events = await contract.MyEvent(1234, null).since({
  fromBlock: -10,
  toBlock: -1,
});
// Get events named 'MyEvent' matching the named arguments passed that occurred
// in the last block.
events = await contract.MyEvent({
  arg1Name: 1234,
  arg2Name: null,
});

```

##### Options
`since()` can take the an options object with the following optional fields:
```js
{
  // Block number to start the search.
  // Negative values are backwards offsets from the last block.
  // Defaults to -1.
  fromBlock: string,
  // Block number to start the search.
  // Negative values are backwards offsets from the last block.
  // Defaults to -1.
  toBlock: string,
  // Address of contract. May be an ENS address.
  // Defaults to contract.address.
  address: string,
}
```

### Live Events
Events can be monitored as they happen by calling a method with the same name as the event then calling `watch()` on returned object. This will create an [EventEmitter](https://nodejs.org/api/events.html) object. Filters are defined as in [past events](#past-events),
but you cannot specify a block range, since watches always scan the current block.

Internally, watches are implemented as polled versions of [past events](#past-events) and you can configure the poll rate via the `pollRate` option. When you no longer need a watcher, you should call its `close()` method to avoid memory leaks and network
congestion.

###### Examples
```js
// Watch for all events named 'MyEvent' that matches `1234` as the first
// argument and any second argument.
let watcher = contract.MyEvent(1234, null).watch();
// a 'data' event is raised whenever a new matching event is seen.
watcher.on('data', function(event) => {
  // Handle the event.
  // ...
  // Done with watcher.
  this.close();
});
// Watch for events named 'MyEvent' matching some arguments by name, and poll
// every 15 seconds.
watcher = contract.MyEvent({arg1Name: 1234, arg2Name: null})
  .watch({ pollRate: 15000 });
// Stop polling.
watcher.close();
```

##### Full options
`watch()` can take the following options:
```js
{
  // How often to scan new blocks, in milliseconds.
  // defaults to 15000 (15 seconds).
  pollRate: string,
  // Address of contract. May be an ENS address.
  // Defaults to contract.address.
  address: string,
  // Named arguments values to filter events by.
  // e.g., {ARG_NAME_0: ARG_VALUE_0, ARG_NAME_1: ARG_VALUE_1, ... }
  // Do not pass positional arguments if used.
  args: object
}
```

### Encoding/Decoding rules
There are a few rules to follow when passing values into contract methods and
event filters, and how to expect them.

##### Integer Types
- Should be passed in as a native `number` type or
converted to base-10 or base-16 string (.e.g, `'1234'` or `'0x04d2'`).
- Decoded as a base-10 string. (.e.g., `'1234'`).

##### Bytes and Address Types
- Bytes be passed in as a hex string (e.g., `'0x1337b33f...'`).
- Addresses can be either a hex string or an ENS address (e.g., `'ethereum.eth'`).
- If they are not the correct size, they will be left-padded to fit, *which
can have unintended consequences*, so you should normalize the input yourself.
- Bytes types are decoded as a lowercase hex string (e.g., `'0x1337b33f...'`).
- Address types are decoded as a *checksum* address, which is a mixed case hex
string.

##### Tuples (multiple return values)
- Decoded as an object with keys for both each value's position and name
(if available). For example:
```javascript
// Solidity definition:
function myConstantFn() pure returns (uint256 a, address b, bytes32 c) {
   return (1024,
    0x0420DC92A955e3e139b52142f32Bd54C6D46c023,
    0x3dffba3b7f99285cc73642eac5ac7110ec7da4b4618d99f3dc9f9954a3dacf27);
}
// flex-contract call
await contract.myConstantFn();
// Output:
// {
//    '0': '1024',
//    '1': '0x0420DC92A955e3e139b52142f32Bd54C6D46c023',
//    '2': '0x3dffba3b7f99285cc73642eac5ac7110ec7da4b4618d99f3dc9f9954a3dacf27A',
//    'a': '1024',
//    'b': '0x0420DC92A955e3e139b52142f32Bd54C6D46c023',
//    'c': '0x3dffba3b7f99285cc73642eac5ac7110ec7da4b4618d99f3dc9f9954a3dacf27A'
// }
```

### ENS addresses
Anywhere you can pass an address, you can instead pass an
[ENS address](http://docs.ens.domains/en/latest/introduction.html), such as
`'thisismyensaddress.eth'`. If an ENS address cannot be resolved, an
exception will be raised. For event watchers, it will be emitted
in an `'error'` event.  

ENS is only available on the main, ropsten, and rinkeby networks.
The ENS address will also have to be set up with the ENS contract on the
respective network to properly resolve.

##### The ENS cache
Once an address is resolved, the address will be cached for future calls.
Each address has a TTL, or time-to-live, defined, which specifies how long
the cache should be retained. However, many ENS registrations unintentionally
leave the TTL at the default of `0`, which would imply no caching.
So, by default, cache TTLs are clamped to be at least one hour. You can
configure this behavior yourself by setting the
`FlexContract.ens.minTTL` property to the minimum number of *milliseconds* to
keep a cache entry.

### Cloning
You can clone an existing flex-contract instance with the `clone()` method.
This method accepts an options object that overrides certain properties of the
original instance.

##### Full options
```js
cloned = conract.clone(
   // Optional overrides.
   {
      // Set the deployed address.
      address: string,
      // Set the contract's bytecode, used in `new()`.
      bytecode: string,
      // Set the gas price bonus.
      // Should be a number, where 0.01 = +1%.
      gasPriceBonus: string,
      // Set the gas limit bonus.
      // Should be a number, where 0.01 = +1%.
      gasBonus: string,
      // Provide a web3 instance.
      web3: object,
      // Provide a provider instance.
      provider: object,
      // Connect to a different providerURI (.e.g, 'http://localhost:8545').
      providerURI: string,
      // Connect to a different network ('main', 'rinkeby', 'ropsten', 'kovan').
      network: string,
      // Your Infura project ID. You should provide the `network` option as well
      // if you pass this, or else the network will default to `main`.
      infuraKey: string
   });
```

### Instance Properties
A contract instance exposes a few properties, most of which you are free to
change. Many of these can also be overridden in individual call options.

- `address (string)` Address the contract is deployed to (may be ENS).
- `gasBonus (string)` Gas limit estimate bonus for transactions, where `0.01 = +1%`. May be negative.
- `gasPriceBonus (string)` Gas price bonus for transactions, where `0.01 = +1%`. May be negative.
- `bytecode` Bytecode of the contract (if available), used for deployment with `new()`.
- `web3 (Web3)` The wrapped Web3 instance used.
- `eth (FlexEther)` The [flex-ether](https://github.com/merklejerk/flex-ether) instance used.
- `abi` (Read-only) The ABI defining the contract.
