![build status](https://travis-ci.org/cluracan/flex-contract.svg?branch=master)
![npm package](https://badge.fury.io/js/flex-contract.svg)

# flex-contract
A modern Ethereum smart contract abstraction for power users that:

- Requires minimal configuration to get going on all networks (no provider necessary).
- Can sign and send transactions from arbitrary accounts.
- Can decode internal events (transaction events raised in other contracts).
- Facilitates easy event filtering and monitoring.
- Provides separate promises for transaction hashes and receipts.

## Installation
```bash
npm install flex-contract
# or
yarn install flex-contract
```

## Preview

```javascript
const FlexContract = require('flex-contract');
// May be a plain ABI or a truffle artifact.
const ABI = require('./MyContract.ABI.json');
// Should be the hex-encoded binary output of solc/truffle.
const BYTECODE = require('./MyContract.bytecode.bin');
// Previously deployed contract address.
const DEPLOYED_AT = '0xf6fb5b73987d6d9a139e23bab97be6fc89e0dcd1';
// A self-signing account for transactions.
const PRIVATE_KEY = '0xb3734ec890893585330c71ece72afb05058192b6be47bee2b99714e6bb5696ab';

// Define a contract interface on ropsten.
let contract = new FlexContract(ABI, {bytecode: BYTECODE, network: 'ropsten'});
// Deploy it, signed by an arbitrary account.
const tx = contract.new({key: PRIVATE_KEY});
// Get the transaction hash.
await tx.txId;
// Get the receipt, you can also just wait on the `tx` object itself.
await tx.receipt;
// Make a transaction call to the newly deployed contract.
const receipt2 = await contract.myTransactionFn('1234', {key: PRIVATE_KEY});
// Find some transaction events.
receipt2.findEvents('MyEvent');

// Define a contract interface bound to an address on the mainnet.
contract = new FlexContract(ABI, DEPLOYED_AT);
// Call a constant function and get the result(s).
await contract.myConstantFn();
// Find events from the last 16 blocks.
await contract.MyEvent({fromBlock: -16});
// Track events as they happen.
const watcher = contract.MyEvent.watch();
watcher.on('data', event => {
      // Handle event.
   });

// Define a contract interface bound to an address using an existing provider.
contract = new FlexContract(ABI,
   {address: DEPLOYED_AT, provider: web3.currentProvider});
// Make a transaction call signed by the provider's wallet.
await contract.myTransactionFn('1337');
// Make a transaction call signed by an arbitrary account.
await contract.myTransactionFn('1337', {key: PRIVATE_KEY});
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
- [Cloning](#cloning)
- [Instance Properties](#instance-properties)

### Creating a flex contract
The only requirement for creating an instance is the ABI, which can be a plain
ABI outputted by [solc](https://github.com/ethereum/solidity), or a
Truffle artifact produced by the [truffle suite](https://truffleframework.com/).

By default, the instance will create an [Infura](https://infura.io) provider to
talk to the main network. You can modify this behavior with the options
`network`, `infuraKey`, `web3`, `provider`, or `providerURI`.

```javascript
const FlexContract = require('flex-contract');
// May be a plain ABI or a truffle artifact.
const ABI = require('./MyContract.ABI.json');
// Previously deployed contract address.
const DEPLOYED_AT = '0xf6fb5b73987d6d9a139e23bab97be6fc89e0dcd1';

// On mainnet, not bound to any address, Infura provider.
// ABI can be plain or truffle artifact.
new FlexContract(ABI);
// Binding to a deployed address, on mainnet, Infura provider.
new FlexContract(ABI, DEPLOYED_AT);
// On a different network, Infura provider.
new FlexContract(ABI, {
      address: DEPLOYED_AT,
      network: 'ropsten' // Or 'rinkeby', 'kovan', 'main'.
   });
// Using your own Infura API key.
new FlexContract(ABI, {
      address: DEPLOYED_AT,
      infuraKey: 'MyInfuraKey'
   });
// Custom provider URI (http://, https://, ws:// or IPC path).
new FlexContract(ABI, {
      address: DEPLOYED_AT,
      providerURI: 'http://localhost:8545'
   });
// Using an existing provider (e.g., Metamask).
new FlexContract(ABI, {
      address: DEPLOYED_AT,
      provider: web3.currentProvider
   });
// Using an existing web3 instance.
// Lightest option, if you're creating lots of instances.
new FlexContract(ABI, {
      address: DEPLOYED_AT,
      web3: new Web3(web3.currentProvider)
   });
// Full option defaults. None are required.
new FlexContract(ABI, {
   // Deployed address of contract. Can be overridden in calls.
   address: undefined,
   // Network to use with Infura provider.
   network: 'main',
   // Infura API Key. Good idea to provide your own.
   infuraKey: undefined,
   // Full provider URI
   // (e.g., http://localhost:8545 or https://mainnet.infura.io/YOURAPIKEY).
   // If using IPC, pass an extra 'net' option which is just require('net').
   providerURI: undefined,
   // Provider instance (.e.g, web3.currentProvider for embedded web3).
   provider: undefined,
   // Web3 instance.
   web3: undefined,
   // Hex-encoded string output of solc --bin.
   // If the ABI passed as the first argument is a truffle artifact,
   // the bytecode will already be defined.
   bytecode: undefined,
   // Fractional bonus to apply to gas price when making transactions.
   // 0.01 = +1%. May be negative to under-price.
   gasPriceBonus: -0.005,
   // Fractional bonus to apply to gas limit estimates when making transactions.
   // 0.01 = +1%. May be negative, but probably not a good idea.
   gasBonus: 0.33
});
```

### Making read-only (constant) calls
Constant contract functions (view, pure, etc.) are exposed as async methods
on the contract instance, which resolve to the returned value(s) of each
function. Function arguments can be passed normally, by position, or by name
through the `args` option.

By default, these calls will be made from the address specified by
`web3.eth.defaultAccount` or `web3.eth.getAccounts()[0]`. You can override the
caller by either passing the `from` or `key` option.

Functions that return multiple values will resolve to an object whose keys are
*both* the return value name (if available) and position index.
See [Encoding/Decoding Rules](#encodingdecoding-rules) for more information on how
arguments and return values are encoded and decoded.

```javascript
const FlexContract = require('flex-contract');
// May be a plain ABI or a truffle artifact.
const ABI = require('./MyContract.ABI.json');
// Previously deployed contract address.
const DEPLOYED_AT = '0xf6fb5b73987d6d9a139e23bab97be6fc89e0dcd1';

const contract = new FlexContract(ABI, DEPLOYED_AT);

// Calling a function named 'getUint256' that returns a single uint256.
// Returns a base-10 string: e.g., '12345...'
await contract.getUint256(arg1, arg2, ...[moreArgs], opts);
// Calling a function named 'getBool' that returns a bool.
// Returns true or false
await contract.getBool(arg1, arg2, ...[moreArgs], opts);
// Calling a function named 'getBytes32' that returns a bytes32.
// Returns a lowercase hex string: e.g., '0x1234...'
await contract.getBytes32(arg1, arg2, ...[moreArgs], opts);
// Calling a function named 'getString' that returns a string.
// Returns a string: e.g, 'foobar...'
await contract.getString(arg1, arg2, ...[moreArgs], opts);
// Calling a function named 'getAddress' that returns an address.
// Returns a checksum, mixed-case address: e.g., '0x5b690eb0f08DB37734E1a99e37D324c059fDA753'
await contract.getAddress(arg1, arg2, ...[moreArgs], opts);
// Calling a function named 'getUint256Array' that returns an array of uint256.
// Returns an array of base-10 strings: e.g., ['1234', '1235', ...]
await contract.getUint256Array(arg1, arg2, ...[moreArgs], opts);
// Calling a function named 'getMultipleValues' that returns multiple values.
// Returns an object whose keys are the names of each value (if available) as
// well as the return value position index.
// E.g., {'0': VALUE_0, 'name0': VALUE_0, '1': VALUE_1, 'name1': VALUE_1}
await contract.getMultipleValues(arg1, arg2, ...[moreArgs], opts);
// Full call option defaults:
await contract.myConstantFn(...[args], {
   // Named arguments.
   // Do not pass positional arguments if used.
   // e.g., {ARG_NAME_0: ARG_VALUE_0, ARG_NAME_1: ARG_VALUE_1, ... }
   args: undefined,
   // Address of caller.
   // Defaults to web3.eth.defaultAccount or web3.eth.getAccounts()[0]
   from: undefined,
   // Address of contract.
   // Defaults to contract.address.
   address: undefined,
   // Hex-encoded private key.
   // Makes the call from the address derived from this private key.
   key: undefined
});
```

### Making transactions
Transaction (non-constant) functions are also exposed as async methods
on the contract instance. These methods all immediately return an augmented
Promise object (see [Transaction promises](#transaction-promises) for
details) that resolves to the transaction receipt, once the transaction is
mined.

By default, transactions will be signed by the account associated with
`web3.eth.defaultAccount` or `web3.eth.getAccounts()[0]`. You can override the
caller by either passing the `from` or `key` option. The `from` option will
let the provider sign the transaction from an unlocked account, as usual.
But, the `key` option will *self-sign* the transaction with the private key
provided, allowing you to transact from any account you have the private keys
to.

Note that user initiated transactions do not return meaningful values in
Ethereum. However, transactions will resolve to a receipt object, which
contains an `event` array of all (known) events that were raised during the
transaction (see [Receipt Events](#receipt-events)).

See [Encoding/Decoding Rules](#encodingdecoding-rules) for more information on
how arguments and event logs are encoded and decoded.

```javascript
const FlexContract = require('flex-contract');
const ABI = require('./MyContract.ABI.json');
// Previously deployed contract address.
const DEPLOYED_AT = '0xf6fb5b73987d6d9a139e23bab97be6fc89e0dcd1';
// Hex-encoded private key for 0xcd3Fd5ecEAAbC3664D328d956Aaa40FBF76736A3
const PRIVATE_KEY = '0xb3734ec890893585330c71ece72afb05058192b6be47bee2b99714e6bb5696ab';

const contract = new FlexContract(ABI, DEPLOYED_AT);

// Make a transaction function call and wait for the receipt.
await contract.someTransactionFn(arg1, arg2, ...[moreArgs], opts);
/* Result: {
   transactionHash: '0x9eb3f89f8581e6c6df294344b538d44e265c226ae6e8ce6210df497cf2b54bd3',
   blockNumber: 3616104,
   gasUsed: 603013,
   events: [...],
   ... etc.
}
*/
// Make a transaction function call, signed by and sent from the account
// associated with a private key.
await contract.someTransactionFn(arg1, arg2, ...[moreArgs], {
   key: PRIVATE_KEY
});
// Full transaction option defaults:
await contract.myTransactionFn(...[args], {
   // Named arguments.
   // Do not pass positional arguments if used.
   // e.g., {ARG_NAME_0: ARG_VALUE_0, ARG_NAME_1: ARG_VALUE_1, ... }
   args: undefined,
   // Address of caller that will sign the transaction.
   // Must be unlocked by the provider.
   // Defaults to web3.eth.defaultAccount or web3.eth.getAccounts()[0].
   from: undefined,
   // Address of contract.
   // Defaults to contract.address.
   address: undefined,
   // Hex-encoded string private key.
   // Signs the transaction with this private key and sends it from the address
   // associated with it. Overrides 'from' option.
   key: undefined,
   // Gas price to use, as a hex or base-10 string, in wei.
   // If not specified, calculated from network gas price and bonus.
   gasPrice: undefined,
   // Execution gas limit.
   // Should be a Number.
   // If not specified, calculated via `web3.eth.estimateGas()` and bonus.
   gas: undefined,
   // Bonus to apply to gas price calculations.
   // Should be a positive or negative Number, where 0.01 = +1%.
   // If omitted, `contract.gasPriceBonus` will be used.
   gasPriceBonus: undefined,
   // Bonus to apply to gas limit calculations.
   // Should be a positive or negative Number, where 0.01 = +1%.
   // If omitted, `contract.gasBonus` will be used.
   gasBonus: undefined
})
```

### Transaction promises
All transaction calls (including `new()`) return a Promise object that resolves
to the
[transaction receipt](https://web3js.readthedocs.io/en/1.0/web3-eth.html#eth-gettransactionreceipt-return),
once the transaction has been mined. This Promise object also has the fields
`txId` and `receipt`, which are also Promises that resolve with the transaction
 hash and the receipt, respectively. The transaction hash, which resolves when
 the transaction is posted, will typically resolve much sooner than the receipt.

**Example**
```javascript
const FlexContract = require('flex-contract');
const ABI = require('./MyContract.ABI.json');
// Previously deployed contract address.
const DEPLOYED_AT = '0xf6fb5b73987d6d9a139e23bab97be6fc89e0dcd1';

const contract = new FlexContract(ABI, DEPLOYED_AT);

// Make a transaction call and wait for the receipt.
await contract.someTransactionFn(arg1, arg2, ...[moreArgs], opts);
/* Result: {
   transactionHash: '0x9eb3f89f8581e6c6df294344b538d44e265c226ae6e8ce6210df497cf2b54bd3',
   blockNumber: 3616104,
   gasUsed: 603013,
   events: [...],
   ... etc.
}*/

// Make a transaction call and wait for the transaction hash.
await contract.someTransactionFn(arg1, arg2, ...[moreArgs], opts);
// Result: '0x9eb3f89f8581e6c6df294344b538d44e265c226ae6e8ce6210df497cf2b54bd3'

// Make a transaction call and wait on both separately.
const tx = contract.someTransactionFn(arg1, arg2, ...[moreArgs], opts);
// Wait on transaction hash.
await tx.txId; // '0x9eb3f89f8581e6c6df294344b538d44e265c226ae6e8ce6210df497cf2b54bd3'
// Wait on receipt.
// Exactly the same as doing `await tx`.
await tx.receipt; // {blockNumber:..., etc.}
```

### Deploying a new contract instance
A contract can be deployed via `new()`, which operates similar to a normal
transaction function call.

```javascript
const FlexContract = require('flex-contract');
const ABI = require('./MyContract.ABI.json');
// Should be the hex-encoded binary output of solc/truffle.
const BYTECODE = require('./MyContract.bytecode.bin');

// Create a contract with bytecode data.
// Bytecode option not necessary if ABI is a complete truffle artifact.
const contract = FlexContract(ABI, {bytecode: BYTECODE});

// Deploy a new instance of the contract signed by default account and wait for
// the receipt.
await contract.new(arg1, arg2, ...[moreArgs], opts);
/* Result: {
   contractAddress: '0x059AFFF592bCF0CD2dDaAF83CeC2dbeEDA6f71D5',
   transactionHash: '0x9eb3f89f8581e6c6df294344b538d44e265c226ae6e8ce6210df497cf2b54bd3',
   blockNumber: 3616104,
   gasUsed: 603013,
   ... etc.
}
*/
// contract.address is now set to the deployed address.
contract.address; // '0x059AFFF592bCF0CD2dDaAF83CeC2dbeEDA6f71D5'
// Full deployment option defaults:
await contract.new(...[args], {
   // Bytecode to deploy, as a hex string.
   // If not provided, contract.bytecode will be used.
   bytecode: String,
   // Named arguments.
   // Do not pass positional arguments if used.
   // e.g., {ARG_NAME_0: ARG_VALUE_0, ARG_NAME_1: ARG_VALUE_1, ... }
   args: undefined,
   // Address of caller that will sign the transaction.
   // Must be unlocked by the provider.
   // Defaults to web3.eth.defaultAccount or web3.eth.getAccounts()[0].
   from: undefined,
   // Hex-encoded string private key.
   // Signs the transaction with this private key and sends it from the address
   // associated with it. Overrides 'from' option.
   key: undefined,
   // Gas price to use, as a hex or base-10 string, in wei.
   // If not specified, calculated from network gas price and bonus.
   gasPrice: undefined,
   // Execution gas limit.
   // Should be a Number.
   // If not specified, calculated via `web3.eth.estimateGas()` and bonus.
   gas: undefined,
   // Bonus to apply to gas price calculations.
   // Should be a positive or negative Number, where 0.01 = +1%.
   // If omitted, `contract.gasPriceBonus` will be used.
   gasPriceBonus: undefined,
   // Bonus to apply to gas limit calculations.
   // Should be a positive or negative Number, where 0.01 = +1%.
   // If omitted, `contract.gasBonus` will be used.
   gasBonus: undefined
})
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

````

##### Decoding internal events
Internal events are events that are raised in other contracts during a
transaction. The library will attempt to decode these events only if a
flex-contract had been previously instantiated to that address, from
construction, deployment, or by explicitly setting a contract's address field.

### Past Events
Past events can be retrieved by calling a method on the contract instance
sharing the same name as the event. Arguments passed into the method will
filter results to only those whose arguments match. Event objects follow the
format defined in [receipt objects](#the-event-object).

The range of blocks to search for events can be set through the `fromBlock` and
`toBlock` options. Possible values are all mined block numbers. Negative numbers
can also be used to specify a backwards offset from the last block, where `-1`
is the last block, `-2` is the second to last block, and so on.

```javascript
const FlexContract = require('flex-contract');
const ABI = require('./MyContract.ABI.json');

const contract = new FlexContract(ABI, DEPLOYED_AT);
// Get all events named 'MyEvent' that occurred in the last block.
await contract.MyEvent();
// get all events named 'MyEvent' that occurred in the last 10 blocks.
await contract.MyEvent({
   fromblock: -10,
   toblock: -1,
});
// Get events named 'MyEvent' matching the argument values passed that occurred
// in the last block.
await contract.MyEvent(ARG_VALUE_0, ARG_VALUE_2, ...[moreArgs]);
// Get events named 'MyEvent' matching the NAMED argument values that occurred
// in the last block.
await contract.MyEvent({
      args: {'ARG_NAME_0': ARG_VALUE_0, 'ARG_NAME_1': ARG_VALUE_1, ...}
   });
// Full options defaults.
await contract.MyEvent(...[args], {
      // Block number to start the search.
      // Negative values are backwards offsets from the last block.
      fromBlock: -1,
      // Block number to start the search.
      // Negative values are backwards offsets from the last block.
      toBlock: -1,
      // Address of contract.
      // Defaults to contract.address.
      address: undefined,
      // Named arguments values to filter events by.
      // Do not pass positional arguments if used.
      // e.g., {ARG_NAME_0: ARG_VALUE_0, ARG_NAME_1: ARG_VALUE_1, ... }
      args: undefined
   });
```

### Live Events
Events can be monitored as they happen through the `.watch()` method/property
of each event method, which returns an
[EventEmitter](https://nodejs.org/api/events.html) object.
Filters are defined as in [past events](#past-events),
but you cannot specify a block range, as watches always scan the last block.

Internally, watches are implemented as polled versions of
[past events](#past-events) and you can configure the poll rate via the
`pollRate` option. When you no longer need a
watcher, you should call its `close()` method to avoid memory leaks and network
congestion.

```javascript
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
// Watch for events named 'MyEvent' matching some arguments.
watcher = contract.MyEvent.watch(ARG_VALUE_0, ARG_VALUE_1, ...[moreArgs]);
// ...
// Watch for events named 'MyEvent' matching some arguments by name.
watcher = contract.MyEvent.watch({
      args: {'ARG_NAME_0': ARG_VALUE_0, 'ARG_NAME_1': ARG_VALUE_1, ...}
   });
// ...
// Full options defaults.
watcher = contract.MyEvent.watch(...[args], {
      // How often to scan new blocks, in milliseconds.
      pollRate: 15000,
      // Address of contract.
      // Defaults to contract.address.
      address: undefined,
      // Named arguments values to filter events by.
      // Do not pass positional arguments if used.
      // e.g., {ARG_NAME_0: ARG_VALUE_0, ARG_NAME_1: ARG_VALUE_1, ... }
      args: undefined
   });
// ...
```

### Encoding/Decoding rules
There are a few rules to follow when passing values into contract methods and
event filters, and how to expect them.

##### Integer Types
- Should be passed in as a native `Number` type or
converted to base-10 or base-16 string (.e.g, `'1234'` or `'0x04d2'`).
- Decoded as a base-10 string. (.e.g., `'1234'`).

##### Bytes and Address Types
- Should be passed in as a hex string (.e.g, `'0x1337b33f...'`).
- If they are not the correct size, they will be left-padded to fit, *which
can have unintended consequences*, so you should normalize the input yourself.
- Bytes types are decoded as a lowercase hex string (.e.g, `'0x1337b33f...'`).
- Address types are decoded as a *checksum* address, which is a mixed case hex string.

### Cloning
You can clone an existing flex-contract instance with the `clone()` method.
This method accepts an options object that overrides certain properties of the
original instance.

```javascript
const FlexContract = require('flex-contract');
const ABI = require('./MyContract.ABI.json');

const contract = new FlexContract(ABI, DEPLOYED_AT);
// Clone options defaults.
// Options left out will be inherited from the original.
const cloned = conract.clone({
   // Set the deployed address.
   address: undefined,
   // Set the contract's bytecode, used in `new()`
   bytecode: undefined,
   // Set the gas price bonus.
   // Should be a number, where 0.01 = +1%.
   gasPriceBonus: undefined,
   // Set the gas limit bonus.
   // Should be a number, where 0.01 = +1%.
   gasLimitBonus: undefined,
   // Use a web3 instance.
   web3: undefined,
   // Use a provider instance.
   providerURI: undefined,
   // Connect to a different providerURI (.e.g, 'http://localhost:8545').
   providerURI: undefined,
   // Connect to a different network ('main', 'rinkeby', 'ropsten', 'kovan').
   network: undefined,
   // Use an infura API key. You should provide the `network` option as well
   // if you pass this, or else it will default to `main`.
   infuraKey: undefined
});
```

### Instance Properties
A contract instance exposes a few properties, most of which you are free to
change. Many of these can also be overridden in individual call options.

- `address (String)` Address the contract is deployed to.
- `gasBonus (Number)` Gas limit estimate bonus for transactions, where `0.01 = +1%`. May be negative.
- `gasPriceBonus (Number)` Gas price bonus for transactions, where `0.01 = +1%`. May be negative.
- `bytecode` Bytecode of the contract, used for deployment with `new()`.
- `web3 (Web3)` Web3 instance used.
- `abi` (Read-only) The ABI defining the contract.
