![build status](https://travis-ci.org/merklejerk/flex-contract.svg?branch=master)
![npm package](https://badge.fury.io/js/flex-contract.svg)

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
const tx = contract.new({key: PRIVATE_KEY, bytecode: BYTECODE});
// Wait for the transaction hash.
await tx.txId;
// Wait for the receipt, you can also just wait on the `tx` object itself.
await tx.receipt;
// Wait for the receipt after 3 confirmations.
await tx.confirmed(3);
// Call a constant function and wait for the result(s).
await contract.myConstantFn();
// Make a transaction call to the contract, signed by an
// private key, and wait for the receipt.
let receipt = await contract.myTransactionFn('1234', {key: PRIVATE_KEY});
// Find some transaction events in the receipt.
let events = receipt.findEvents('MyEvent');
// Find all contract events named 'MyEvent' from the last 16 blocks.
events = await contract.MyEvent({fromBlock: -16});
// Track events as they happen.
const watcher = contract.MyEvent.watch();
watcher.on('data', event => {
      // Handle event.
   });
```

## User Guide
- [Creating a flex contract](#creating-a-flex-contract)
- [Making read-only (constant) calls](#making-read-only-constant-calls)
- [Making transactions](#making-transactions)
- [Transaction promises](#transaction-promises)
- [Deploying a new contract instance](#deploying-a-new-contract-instance)
- [Receipt events](#receipt-events)
- [Past events](#past-events)
- [Live events](#live-events)
- [Encoding/Decoding Rules](#encodingdecoding-rules)
- [ENS addresses](#ens-addresses)
- [Cloning](#cloning)
- [Instance Properties](#instance-properties)
- [Passing Structs](#passing-structs)

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
   ABI: Object | Array,
   // Deployed address of contract. May be an ENS address (e.g., 'ethereum.eth').
   // May omitted.
   address: String,
   // Options object. May be omitted.
   {
      // Network to use with Infura provider.
      // May be 'main', 'ropsten', 'rinkeby', or 'kovan'.
      // Defaults to 'main'
      network: String,
      // Your Infura project ID, if not passing a custom provider.
      infuraKey: String,
      // Connect to an existing provider at a URI
      // (e.g., http://localhost:8545 or https://mainnet.infura.io/v3/PROJECT_ID).
      // The 'net' option is required is using an IPC path.
      providerURI: String,
      // net instance, from require('net'), if using IPC path in providerURI
      net: Object,
      // Use a custom provider instance (e.g., web3.currentProvider for metamask).
      // Overrides all provider options.
      provider: Object,
      // Use a custom web3 instance (that will be wrapped in a FlexEther).
      // Overrides all provider options.
      web3: Object,
      // Use a custom FlexEther (web3 wrapper) instance.
      // Overrides all provider options.
      // See https://github.com/merklejerk/flex-ether
      eth: FlexEther,
      // Hex-encoded string output of solc --bin.
      // If the ABI passed as the first argument is a truffle artifact,
      // the bytecode will already be defined.
      bytecode: String,
      // Fractional bonus to apply to gas price when making transactions.
      // 0.01 = +1%. May be negative to under-price.
      // Defaults to -0.005.
      // Can be overridden in method calls.
      gasPriceBonus: Number,
      // Fractional bonus to apply to gas limit estimates when making transactions.
      // 0.01 = +1%. May be negative, but probably not a good idea.
      // Defaults to 0.66
      // Can be overridden in method calls.
      gasBonus: Number
   });
```

### Making read-only (constant) calls
Constant contract functions (view, pure, etc.) are exposed as async methods
on the contract instance, which resolve to the returned value(s) of each
function. Function arguments can be passed normally, by position, or by name
through the `args` option.

By default, these calls will be made from the address specified by
`web3.eth.defaultAccount` or `web3.eth.getAccounts()[0]`. You can override the
caller by either passing the `from` or `key` option. Note that a private key
is not necessary for constant calls because they are not signed transactions,
so the `from` option is sufficient. Also, not all functions will require a
valid caller, so it may be left undefined in those cases. One classic
example is the ERC20 `balanceOf()` function.

There are rules for how function arguments and return values are encoded and
decoded. See [Encoding/Decoding Rules](#encodingdecoding-rules) for more
information.


##### Examples
```js
const FlexContract = require('flex-contract');
// May be a plain ABI or a truffle artifact.
const ABI = require('./MyContract.ABI.json');
// Previously deployed contract address.
const DEPLOYED_AT = '0xf6fb5b73987d6d9a139e23bab97be6fc89e0dcd1';
const contract = new FlexContract(ABI, DEPLOYED_AT);

// Calling a constant function named 'myConstantFn' with 2 positional arguments
// that resolves to its return value(s).
let result = await contract.myConstantFn(arg1, arg2, opts);
// Calling a constant function named 'myConstantFn' with named arguments from
// the wallet '0x520dffED1dc6e3E871d944bb473C3D483F5F3fB9' at block 100.
result = await contract.myConstantFn({
   args: {arg1Name: arg1, arg2Name: arg2},
   from: '0x520dffED1dc6e3E871d944bb473C3D483F5F3fB9',
   block: 100});
```

##### Full options
```js
// Full call option defaults for contract function named 'myConstantFn':
result = await contract.myConstantFn(
   // Positionl argument values.
   ...[args],
   // Options. may be omitted.
   {
      // Named arguments.
      // e.g., {ARG_NAME_0: ARG_VALUE_0, ARG_NAME_1: ARG_VALUE_1, ... }
      // Do not pass positional arguments if used.
      args: Object,
      // Address of caller. May be an ENS address.
      // Defaults to web3.eth.defaultAccount or web3.eth.getAccounts()[0]
      from: String,
      // Hex-encoded private key.
      // Makes the call from the address derived from this private key.
      // Overrides the `from` option.
      key: String,
      // Address of contract. May be an ENS address.
      // Defaults to contract.address.
      address: String,
      // Make the call against the blockchain's state at a specific block number.
      // Can be a previously mined block number, a negative number, or the string
      // 'latest'.
      // If the number is negative, it represents a backwards offset from the
      // last block mined, where -1 is the last block mined, -2 is the second to
      // last, etc.
      // Defaults to -1.
      block: Number
   });
```

### Making transactions
Transaction (non-constant) functions are also exposed as async methods
on the contract instance. These methods all immediately return an augmented
Promise object (see [Transaction promises](#transaction-promises) for
details) that resolves to the transaction receipt, once the transaction is
mined.

By default, transactions will be signed by the wallet associated with
`web3.eth.defaultAccount` or `web3.eth.getAccounts()[0]`. You can override the
caller by either passing the `from` or `key` option. The `from` option will
let the provider sign the transaction from an unlocked wallet, as usual.
But, the `key` option will *self-sign* the transaction with the private key
provided, allowing you to transact from any wallet you have the private keys
to.

Note that user initiated transactions do not return meaningful values in
Ethereum. However, transactions will resolve to a receipt object, which
contains an `event` array of all (known) events that were raised during the
transaction (see [Receipt Events](#receipt-events)).

See [Encoding/Decoding Rules](#encodingdecoding-rules) for more information on
how arguments and event logs are encoded and decoded.

##### Examples
```js
const FlexContract = require('flex-contract');
const ABI = require('./MyContract.ABI.json');
// Previously deployed contract address.
const DEPLOYED_AT = '0xf6fb5b73987d6d9a139e23bab97be6fc89e0dcd1';
// Hex-encoded private key for 0xcd3Fd5ecEAAbC3664D328d956Aaa40FBF76736A3
const PRIVATE_KEY = '0xb3734ec890893585330c71ece72afb05058192b6be47bee2b99714e6bb5696ab';
const contract = new FlexContract(ABI, DEPLOYED_AT);

// Make a transaction function call, passing two position arguments and
// wait for the receipt.
let receipt = await contract.someTransactionFn(arg1, arg2, opts);
/* Result: <Receipt Object> {
   transactionHash: '0x9eb3f89f8581e6c6df294344b538d44e265c226ae6e8ce6210df497cf2b54bd3',
   blockNumber: 3616104,
   gasUsed: 603013,
   events: [...],
   ... etc.
}
*/
// Make a transaction function call, passing two named arguments,
// signed by and sent from the wallet defined by a private key,
// and wait for the receipt.
receipt = await contract.someTransactionFn({
   args:{arg1Name: arg1, arg2Name: arg2},
   key: PRIVATE_KEY
});
```

##### Full options
```js
// Full transaction option defaults for contract function named 'myTransactionFn':
tx = await contract.myTransactionFn(
   // Positional argument values.
   ...[args],
   // Options. may be omitted.
   {
      // Named arguments.
      // e.g., {ARG_NAME_0: ARG_VALUE_0, ARG_NAME_1: ARG_VALUE_1, ... }
      // Do not pass positional arguments if used.
      args: Object,
      // Address of caller that will sign the transaction.
      // Must be unlocked by the provider.
      // Defaults to web3.eth.defaultAccount or web3.eth.getAccounts()[0].
      from: String,
      // Hex-encoded private key.
      // Signs the transaction with this private key and sends it from the address
      // associated with it. Overrides `from` option.
      key: String,
      // Address of contract. May be an ENS address.
      // Defaults to contract.address.
      address: String,
      // Amount of ether to attach to this transaction, in wei.
      // Can be a base-10 or hex-encoded string.
      value: String,
      // Gas price to use, as a hex or base-10 string, in wei.
      // If not specified, it will be calculated from network gas price with bonus.
      gasPrice: String,
      // Execution gas limit.
      // If not specified, will be estimated with bonus.
      gas: Number,
      // Bonus to apply to gas price calculations.
      // Should be a positive or negative Number, where 0.01 = +1%.
      // If omitted, `contract.gasPriceBonus` will be used.
      gasPriceBonus: Number,
      // Bonus to apply to gas limit calculations.
      // Should be a positive or negative Number, where 0.01 = +1%.
      // If omitted, `contract.gasBonus` will be used.
      gasBonus: Number,
      // If set to true, this call will ONLY estimate the gas used and resolve
      // to a Number, which is the total gas used (with bonuses).
      gasOnly: Boolean
   });
```

### Transaction promises
All transaction calls (including `new()`) return a Promise object that resolves
to the
[transaction receipt](https://web3js.readthedocs.io/en/1.0/web3-eth.html#eth-gettransactionreceipt-return),
once the transaction has been mined.

This Promise object also has the following properties:
- `txId`: a promise that resolves to the transaction hash when the transaction is
posted to the blockchain. This ususally comes much sooner than the receipt.
- `receipt`: a promise that resolves to the transaction receipt when the
transaction has been mined. Same as waiting on the parent object itself.
- `confirmed(count=1)` a function that returns a promise that resolves to the
transaction receipt after the transaction has been mined and `count` number of
confirmations have been seen, up to a maximum of 12 confirmations.

##### Example
```js
const FlexContract = require('flex-contract');
const ABI = require('./MyContract.ABI.json');
// Previously deployed contract address.
const DEPLOYED_AT = '0xf6fb5b73987d6d9a139e23bab97be6fc89e0dcd1';

const contract = new FlexContract(ABI, DEPLOYED_AT);

// Make a transaction call and wait for the receipt.
await contract.someTransactionFn(arg1, arg2, opts);
/* Result: <Receipt Object> {
   transactionHash: '0x9eb3f89f8581e6c6df294344b538d44e265c226ae6e8ce6210df497cf2b54bd3',
   blockNumber: 3616104,
   gasUsed: 603013,
   events: [...],
   ... etc.
}*/

// Make a transaction call and wait for the transaction hash.
await contract.someTransactionFn(arg1, arg2, opts).txId;
// Result: '0x9eb3f89f8581e6c6df294344b538d44e265c226ae6e8ce6210df497cf2b54bd3'
// Make a transaction call and wait for the confirmation.
await contract.someTransactionFn(arg1, arg2, opts).txId;
// Result: <Receipt Object>

// Make a transaction call, immediately getting the promise object.
const tx = contract.someTransactionFn(arg1, arg2, opts);
// Wait on transaction hash.
await tx.txId; // '0x9eb3f89f8581e6c6df294344b538d44e265c226ae6e8ce6210df497cf2b54bd3'
// Wait on receipt.
// Exactly the same as doing `await tx`.
await tx.receipt; //  <Receipt Object>{blockNumber:..., etc.}
// Wait on 4 confirmations.
await tx.confirmed(4); // <Receipt Object> {blockNumber:..., etc.}
```

### Deploying a new contract instance
A contract can be deployed via `new()`, which operates similar to a normal
transaction function call.

##### Example
```js
const FlexContract = require('flex-contract');
const ABI = require('./MyContract.ABI.json');
// Should be the hex-encoded binary output of solc/truffle.
const BYTECODE = require('./MyContract.bytecode.bin');

// Create a contract with bytecode data.
const contract = FlexContract(ABI);

// Deploy a new instance of the contract, passing two positional arguments
// to the constructor, signed by default wallet and wait for the receipt.
// Bytecode option not necessary if ABI was a truffle artifact.
const receipt = await contract.new(arg1, arg2, {bytecode: BYTECODE});
/* Result: <Receipt Object> {
   contractAddress: '0x059AFFF592bCF0CD2dDaAF83CeC2dbeEDA6f71D5',
   transactionHash: '0x9eb3f89f8581e6c6df294344b538d44e265c226ae6e8ce6210df497cf2b54bd3',
   blockNumber: 3616104,
   gasUsed: 603013,
   ... etc.
}
*/
// contract.address is now set to the deployed address.
contract.address; // '0x059AFFF592bCF0CD2dDaAF83CeC2dbeEDA6f71D5'
// receipt also has deployed contract address.
receipt.address; // '0x059AFFF592bCF0CD2dDaAF83CeC2dbeEDA6f71D5'
```

##### Full options
```js
// Full deployment option defaults:
receipt = await contract.new(
   // Positional argument values.
   ...[args],
   // Options. may be omitted.
   {
      // Bytecode to deploy, as a hex string.
      // If not provided, contract.bytecode will be used.
      bytecode: String,
      // Named arguments.
      // e.g., {ARG_NAME_0: ARG_VALUE_0, ARG_NAME_1: ARG_VALUE_1, ... }
      // Do not pass positional arguments if used.
      args: Object,
      // Address of caller that will sign the transaction.
      // Must be unlocked by the provider.
      // Defaults to web3.eth.defaultAccount or web3.eth.getAccounts()[0].
      from: String,
      // Hex-encoded string private key.
      // Signs the transaction with this private key and sends it from the address
      // associated with it. Overrides 'from' option.
      key: String,
      // Amount of ether to attach to this transaction, in wei.
      // Can be a base-10 or hex-encoded string.
      value: String,
      // Gas price to use, as a hex or base-10 string, in wei.
      // If not specified, calculated from network gas price with bonus.
      gasPrice: String,
      // Execution gas limit.
      // If not specified, will be estimated with bonus.
      gas: String,
      // Bonus to apply to gas price calculations.
      // Should be a positive or negative Number, where 0.01 = +1%.
      // If omitted, `contract.gasPriceBonus` will be used.
      gasPriceBonus: Number,
      // Bonus to apply to gas limit calculations.
      // Should be a positive or negative Number, where 0.01 = +1%.
      // If omitted, `contract.gasBonus` will be used.
      gasBonus: Number,
      // If set to true, this call will ONLY estimate the gas used and resolve
      // to a Number, which is the total gas used (with bonuses).
      gasOnly: Boolean
   });
```

### Receipt Events
Receipts resolved from transaction calls follow the format of web3
[transaction receipts](https://web3js.readthedocs.io/en/1.0/web3-eth.html#eth-gettransactionreceipt-return),
augmented with a few extra fields:

- `events`: array of parsed event objects.
- `findEvent(name, args)`: method to find the first event matching a provided arguments object.
- `findEvents(name, args)`: method to find all events matching a provided arguments object.

##### The Event Object
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
const FlexContract = require('flex-contract');
const ABI = require('./MyContract.ABI.json');

const contract = new FlexContract(ABI, DEPLOYED_AT);
const receipt = await contract.someTransactionFn(arg1, arg2, ...[moreArgs], opts);
// List events.
receipt.events; // [{name:..., args:...}, ... etc.]
// Find an event named 'MyEvent' matching certain argument values.
// Returns one event.
receipt.findEvent('MyEvent', {argName0: argValue0, ...});
// Find all events named 'MyEvent' matching certain argument values.
// Returns a list.
receipt.findEvents('MyEvent', {argName0: argValue0, ...});

```

##### Decoding internal events
Internal events are events that are raised in other contracts during a
transaction. The library will attempt to decode these events only if a
flex-contract had been previously instantiated to that address, from
construction, deployment, or by explicitly setting a contract's address field.

### Past Events
Past events can be retrieved by calling a method on the contract instance
sharing the same name as the event. Arguments passed into the method will
filter results to only those whose arguments match. You may also omit
arguments or pass them as null to match any value. Event objects follow the
format defined in [receipt objects](#the-event-object).

The range of blocks to search for events can be set through the `fromBlock` and
`toBlock` options. Possible values are all mined block numbers. Negative numbers
can also be used to specify a backwards offset from the last block, where `-1`
is the last block, `-2` is the second to last block, and so on.

##### Examples
```js
const FlexContract = require('flex-contract');
const ABI = require('./MyContract.ABI.json');

const contract = new FlexContract(ABI, DEPLOYED_AT);
// Get all events named 'MyEvent' that occurred in the last block.
// `events` is an array of event objects.
let events = await contract.MyEvent();
// Get all events named 'MyEvent' that occurred in the last 10 blocks.
events = await contract.MyEvent({
   fromBlock: -10,
   toBlock: -1,
});
// Get events named 'MyEvent' matching the positional arguments passed that occurred
// in the last block.
await contract.MyEvent(arg1, arg2);
// Get events named 'MyEvent' matching the NAMED arguments passed that occurred
// in the last block.
await contract.MyEvent({
      args: {arg1Name: arg1, arg2Name: arg2}
   });
```

##### Full options
```js
// Get past events for contract event named 'MyEvent'.
events = await contract.MyEvent(
      // Positional argument filter.
      ...[args],
      // Options. may be omitted.
      {
         // Block number to start the search.
         // Negative values are backwards offsets from the last block.
         // Defaults to -1.
         fromBlock: Number,
         // Block number to start the search.
         // Negative values are backwards offsets from the last block.
         // Defaults to -1.
         toBlock: Number,
         // Address of contract. May be an ENS address.
         // Defaults to contract.address.
         address: String,
         // Named arguments values to filter events by.
         // e.g., {ARG_NAME_0: ARG_VALUE_0, ARG_NAME_1: ARG_VALUE_1, ... }
         // Do not pass positional arguments if used.
         args: object
   });
```

### Live Events
Events can be monitored as they happen through the `.watch()` method/property
of each event method, which returns an
[EventEmitter](https://nodejs.org/api/events.html) object.
Filters are defined as in [past events](#past-events),
but you cannot specify a block range, as watches always scan the last block.

Argument filters follow the same format as in [Past Events](#past-events).

Internally, watches are implemented as polled versions of
[past events](#past-events) and you can configure the poll rate via the
`pollRate` option. When you no longer need a
watcher, you should call its `close()` method to avoid memory leaks and network
congestion.

###### Examples
```js
const FlexContract = require('flex-contract');
const ABI = require('./MyContract.ABI.json');

const contract = new FlexContract(ABI, DEPLOYED_AT);
// Watch for all events named 'MyEvent'
let watcher = contract.MyEvent.watch();
// 'data' event is raised for each matching event.
watcher.on('data', function(event) => {
      // Handle the event.
      // ...
      // Done with watcher.
      this.close();
   });
// Watch for events named 'MyEvent' matching positional arguments.
watcher = contract.MyEvent.watch(arg1, arg2);
// ...
// Watch for events named 'MyEvent' matching some arguments by name.
watcher = contract.MyEvent.watch({
      args: {arg1Name: arg1, arg2Name: arg2}
   });
// Stop polling.
watcher.close();
```

##### Full options
```js
// Monitor live events for contract event named 'MyEvent'.
watcher = contract.MyEvent.watch(
   // Positional argument filters.
   ...[args],
   // Options. may be omitted.
   {
      // How often to scan new blocks, in milliseconds.
      // defaults to 15000 (15 seconds).
      pollRate: Number,
      // Address of contract. May be an ENS address.
      // Defaults to contract.address.
      address: String,
      // Named arguments values to filter events by.
      // e.g., {ARG_NAME_0: ARG_VALUE_0, ARG_NAME_1: ARG_VALUE_1, ... }
      // Do not pass positional arguments if used.
      args: Object
   });
```

### Encoding/Decoding rules
There are a few rules to follow when passing values into contract methods and
event filters, and how to expect them.

##### Integer Types
- Should be passed in as a native `Number` type or
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
      address: String,
      // Set the contract's bytecode, used in `new()`.
      bytecode: String,
      // Set the gas price bonus.
      // Should be a number, where 0.01 = +1%.
      gasPriceBonus: Number,
      // Set the gas limit bonus.
      // Should be a number, where 0.01 = +1%.
      gasBonus: Number,
      // Provide a web3 instance.
      web3: Object,
      // Provide a provider instance.
      provider: Object,
      // Connect to a different providerURI (.e.g, 'http://localhost:8545').
      providerURI: String,
      // Connect to a different network ('main', 'rinkeby', 'ropsten', 'kovan').
      network: String,
      // Your Infura project ID. You should provide the `network` option as well
      // if you pass this, or else the network will default to `main`.
      infuraKey: String
   });
```

### Instance Properties
A contract instance exposes a few properties, most of which you are free to
change. Many of these can also be overridden in individual call options.

- `address (String)` Address the contract is deployed to (may be ENS).
- `gasBonus (Number)` Gas limit estimate bonus for transactions, where `0.01 = +1%`. May be negative.
- `gasPriceBonus (Number)` Gas price bonus for transactions, where `0.01 = +1%`. May be negative.
- `bytecode` Bytecode of the contract, used for deployment with `new()`.
- `web3 (Web3)` The wrapped Web3 instance used.
- `eth (FlexEther)` The [flex-ether](https://github.com/merklejerk/flex-ether)
(web3 wrapper) instance used.
- `abi` (Read-only) The ABI defining the contract.

### Passing Structs
`flex-contract` supports passing and receiving structs to/from your smart
contracts. You must first enable the experimental ABIEncoderV2 support in your
smart contracts.

If you decide to pass a struct (as a plain javascript object) as the last
positional parameter in your call, you *must* supply at least an empty options
object as the last parameter of your call. This allows the library to
differentiate between a struct parameter and an options object.

```js
// ...
// Passing a hex string and struct defined as:
// MyStruct {
//    uint32 foo;
//    bytes3: bar;
// }
// Note the empty options object at the end of the call.
await myContract.passingAStruct('0xdeadbeef', {foo: 1, bar: '0xff3021'}, {});
```
