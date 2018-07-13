'use strict'
const _ = require('lodash');
const Web3 = require('web3');
const ethjs = require('ethereumjs-util');
const ethjstx = require('ethereumjs-tx');
const coder = require('./coder');
const util = require('./util');
const BigNumber = require('bignumber.js');
const EventEmitter = require('events');
const assert = require('assert');

module.exports = class FlexContract {
	constructor(abi, opts={}) {
		if (abi instanceof FlexContract) {
			// Clone.
			return this._copy(abi, opts)
		}
		if (_.isString(opts)) {
			opts = {address: opts};
		}
		if (!opts.web3)
			this._web3 = new Web3(opts.provider || createProvider(opts));
		else
			this._web3 = opts.web3;
		this._chainId = this._web3.eth.net.getId();
		this._abi = abi.abi || abi.abiDefinition || abi;
		this.bytecode = opts.bytecode || abi.bytecode || abi.code
			|| abi.binary || null;
		this.address = opts.address;
		this._contract = new this._web3.eth.Contract(this._abi, opts.address);
		this.gasBonus = _.isNumber(opts.gasBonus) ? opts.gasBonus : 0.33;
		this.gasPriceBonus = _.isNumber(opts.gasPriceBonus) ?
			opts.gasPriceBonus : -0.005;
		initMethods(this, this._abi);
		initEvents(this, this._abi);
	}

	_copy(inst, opts={}) {
		if (!opts.web3) {
			if (opts.provider)
				this._web3 = new Web3(opts.provider);
			else if (opts.providerURI || opts.network || opts.infuraKey)
				this._web3 = new Web3(createProvider(opts));
			else
				this._web3 = inst._web3;
		}
		else
			this._web3 = opts.web3;
		this._chainId = this._web3.eth.net.getId();
		this._abi = inst._abi;
		this.address = opts.address || inst._address;
		this.bytecode = opts.bytecode || inst.bytecode;
		this._contract = inst._contract;
		this.gasBonus = _.isNumber(opts.gasBonus) ?
			opts.gasBonus : inst.gasBonus;
		this.gasPriceBonus = _.isNumber(opts.gasPriceBonus) ?
			opts.gasPriceBonus : inst.gasPriceBonus;
		initMethods(this, this._abi);
		initEvents(this, this._abi);
		return this;
	}

	clone(opts={}) {
		return new FlexContract(this, opts);
	}

	get abi() {
		return this._abi;
	}

	get contract() {
		return this._contract;
	}

	get web3() {
		return this._web3;
	}

	set web3(v) {
		this._web3._chainId = v.eth.net.getId();
		this._web3 = v;
	}

	get address() {
		return this._address;
	}

	set address(v) {
		if (_.isString(v)) {
			if (!ethjs.isValidAddress(v))
				throw new Error(`Invalid address: ${v}`);
			this._address = ethjs.toChecksumAddress(v);
			module.exports.ABI_CACHE[this._address] = this._abi;
		}
		else
			this._address = undefined;
	}

	async getCodeDigest(opts={}) {
		return getCodeDigest(this, opts);
	}

	new(..._args) {
		const {args, opts} = parseMethodCallArgs(_args);
		const def = findDef(this._abi, {type: 'constructor', args: args});
		if (!def)
			throw new Error(`Cannot find matching constructor for given arguments`);
		const r = wrapSendTxPromise(this, null, sendTx(this, def, args, opts));
		// Set address and cache the ABI on successful deploy.
		r.receipt.then(
			receipt => {
				const addr = ethjs.toChecksumAddress(receipt.contractAddress);
				this._address = addr;
				module.exports.ABI_CACHE[addr] = this._abi;
			});
		return r;
	}
};
module.exports.ABI_CACHE = {};
module.exports.MAX_GAS = 6721975;

class EventWatcher extends EventEmitter {
	constructor(opts) {
		super();
		this._inst = opts.inst;
		this._filter = opts.filter;
		this._def = opts.def;
		this._args = opts.args;
		this.pollRate = opts.pollRate;
		this._timer = null;
		this._stop = false;
		this.stop = this.close;
		this._init();
	}

	async _init() {
		const web3 = this._inst.web3;
		this._lastBlock = await web3.eth.getBlockNumber();
		if (!this._stop)
			this._timer = setTimeout(() => this._poll(), this.pollRate);
	}

	async _poll() {
		if (this._stop || _.isNil(this._lastBlock))
			return;
		try {
			const web3 = this._inst.web3;
			const currentBlock = await web3.eth.getBlockNumber();
			if (currentBlock > this._lastBlock) {
				const filter = _.assign({}, this._filter,
					{toBlock: currentBlock, fromBlock: this._lastBlock + 1});
				const raw = await web3.eth.getPastLogs(filter);
				this._lastBlock = currentBlock;
				const logs = _.filter(
					_.map(raw, _raw => decodeLogItem(this._def, _raw)),
						log => testEventArgs(log, this._args));
				for (let log of logs)
					this.emit('data', log);
			}
		} catch (err) {
			throw err;
		} finally {
			this._timer = setTimeout(() => this._poll(), this.pollRate);
		}
	}

	close() {
		this._stop = true;
		this._inst = null;
		if (!_.isNil(this._timer)) {
			clearTimeout(this._timer);
			this._timer = null;
		}
	}
}

async function getCodeDigest(inst, opts={}) {
	opts = _.defaults({}, opts, {
		address: inst._address
	});
	const address = opts.address || opts.to;
	if (!address)
		throw new Error('Cannot determine contract adress and it was not provided.');
	const code = await inst._web3.eth.getCode(address, opts.block);
	return Web3.utils.keccak256(code);
}

function findDef(defs, filter={}) {
	for (let def of defs) {
		if (filter.name && def.name != filter.name)
			continue;
		if (filter.type && def.type != filter.type)
			continue;
		if (filter.args) {
			if (_.isArray(filter.args)) {
				if (def.inputs.length != filter.args.length)
					continue;
			} else if (_.isPlainObject(filter.args)) {
				const keys = _.keys(filter.args);
				if (def.inputs.length != keys.length)
					continue;
				const inputNames = _.map(def.inputs, i => i.name);
				if (_.difference(keys, inputNames).length)
					continue;
			}
		} else {
			if (def.inputs.length != 0)
				continue;
		}
		return def;
	}
}

function initMethods(inst, abi) {
	const defs = {};
	for (let def of abi) {
		if (def.type == 'function') {
			const name = def.name;
			const _defs = defs[name] = defs[name] || [];
			_defs.push(def);
			const handler = inst[name] = inst[name] ||
				function (..._args) {
					const {args, opts} = parseMethodCallArgs(_args);
					const def = findDef(_defs, {args: args});
					if (!def)
						throw new Error(`Cannot find matching function '${name}' for given arguments`);
					if (def.constant)
						return callTx(inst, def, args, opts);
					return wrapSendTxPromise(inst, opts.address || opts.to,
						sendTx(this, def, args, opts));
				};
		}
	}
}

function initEvents(inst, abi) {
	for (let def of abi) {
		if (def.type == 'event') {
			const name = def.name;
			const handler = inst[name] = function (opts) {
				return getPastEvents(inst, def, opts);
			};
			handler.watch = function(opts) {
				return watchEvents(inst, def, opts);
			};
		}
	}
}

async function getPastEvents(inst, def, opts={}) {
	opts = _.defaults({}, opts, {
		fromBlock: -1,
		toBlock: -1,
		address: inst._address,
		args: {}
	});
	if (!opts.address)
		throw new Error('Contract does not have an address set and it was not provided.');
	const args = arrangeCallArgs(opts.args || {}, def,
		{partial: true, indexedOnly: true});
	const filter = {
		fromBlock: await resolveBlockDirective(inst, opts.fromBlock),
		toBlock: await resolveBlockDirective(inst, opts.toBlock),
		address: opts.address,
		topics: coder.encodeLogTopicsFilter(def, args)
	};
	const raw = await inst._web3.eth.getPastLogs(filter);
	return _.filter(_.map(raw, _raw => decodeLogItem(def, _raw)),
		log => testEventArgs(log, opts.args));
}

function watchEvents(inst, def, opts) {
	opts = _.defaults({}, opts, {
		address: inst._address,
		args: {},
		pollRate: 15000
	});
	if (!opts.address)
		throw new Error('Contract does not have an address set and it was not provided.');
	const args = arrangeCallArgs(opts.args || {}, def,
		{partial: true, indexedOnly: true});
	const filter = {
		address: opts.address,
		topics: coder.encodeLogTopicsFilter(def, args)
	};
	return new EventWatcher({
		inst: inst,
		filter: filter,
		args: opts.args,
		pollRate: opts.pollRate,
		def: def
	});
}

function testEventArgs(log, args={}) {
	// Args can be an array and this will work because event args can be indexed
	// by offset as well.
	return _.every(
		_.map(_.keys(args), name =>
			name in log.args && log.args[name] == args[name]));
}

async function resolveBlockDirective(inst, directive) {
	if (_.isNumber(directive)) {
		if (directive < 0) {
			if (directive == -1)
				return 'latest';
			let n = await inst.web3.eth.getBlockNumber();
			n += (directive+1);
			if (n < 0)
				throw Error(`Block number offset is too large: ${directive}`);
			return n;
		}
		return directive;
	}
	return directive;
}

async function createCallOpts(inst, def, args, opts) {
	const web3 = inst._web3;
	const data = opts.data || createCallData(inst, def, args, opts);
	const from = opts.from ||
		(opts.key ? util.privateKeyToAddress(opts.key) : undefined) ||
		web3.eth.defaultAccount || await getFirstAccount(web3);
	const chainId = opts.chainId || await inst._chainId;
	const gasPrice = opts.gasPrice || await getGasPrice(inst, opts);
	const gasLimit = opts.gas || opts.gasLimit ||
		await estimateGas(inst, def, args, opts);
	const value = opts.value || 0;
	const to = opts.to || opts.address || inst.address;
	const _opts = {
		chainId: chainId,
		gasPrice: util.toHex(gasPrice),
		gasLimit: util.toHex(gasLimit),
		value: util.toHex(value),
		data: data || '0x',
	};
	if (to)
		_opts.to = _.isString(to) ? ethjs.toChecksumAddress(to) : to;
	if (from)
		_opts.from = _.isString(from) ? ethjs.toChecksumAddress(from) : from;
	return _opts;
}

async function estimateGas(inst, def, args, opts) {
	opts = _.assign({}, opts, {
			gasPrice: 1,
			gasLimit: module.exports.MAX_GAS,
		});
	const _opts = await createCallOpts(inst, def, args, opts);
	if (!_opts.from)
		throw Error('Cannot determine caller.');
	let gasBonus = 0;
	if (_.isNumber(opts.gasBonus))
		gasBonus = opts.gasBonus;
	else if (_.isNumber(inst.gasBonus))
		gasBonus = inst.gasBonus;
	const gas = await inst._web3.eth.estimateGas(_opts, _opts.block);
	return Math.ceil(gas * (1+gasBonus));
}

async function callTx(inst, def, args, opts) {
	opts = _.assign({}, opts, {
			gasPrice: 1,
			gasLimit: module.exports.MAX_GAS,
		});
	const _opts = await createCallOpts(inst, def, args, opts);
	return decodeCallOutput(def,
		await inst._web3.eth.call(_opts, _opts.block));
}

async function sendTx(inst, def, args, opts) {
	opts = _.assign({}, opts, {
			gasPrice: opts.gasPrice || await getGasPrice(inst, opts),
			gasLimit: opts.gasLimit || await estimateGas(inst, def, args, opts),
		});
	const _opts = await createCallOpts(inst, def, args, opts);
	if (!_opts.from)
		throw Error('Cannot determine caller.');
	if (!_opts.to && def.type != 'constructor')
		throw Error('Contract has no address.');
	if (!_.isNil(opts.nonce))
		_opts.nonce = opts.nonce;
	else
		_opts.nonce = await inst._web3.eth.getTransactionCount(_opts.from);
	let sent = null;
	if (opts.key)  {
		// Sign the TX ourselves.
		const tx = new ethjstx(_opts);
		tx.sign(ethjs.toBuffer(opts.key));
		const serialized = util.toHex(tx.serialize());
		sent = inst._web3.eth.sendSignedTransaction(serialized);
	} else {
		// Let the provider sign it.
		sent = inst._web3.eth.sendTransaction(_opts);
	}
	return {sent: sent};
}

async function getFirstAccount(web3) {
	const accts = await web3.eth.getAccounts();
	if (accts && accts.length)
		return accts[0];
}

function wrapSendTxPromise(inst, address, promise) {
	// Resolved receipt object.
	let receipt = undefined;
	// Number of confirmations seen.
	let confirmations = 0;
	// Count confirmations.
	promise.then(({sent}) => {
		/*
		sent.on('confirmation', (n, _receipt) => {
			console.log(n);
			receipt = _receipt;
			confirmations = Math.max(confirmations, n);
		});*/
	});
	// Create a promise that resolves with the receipt.
	const wrapper = new Promise(async (accept, reject) => {
		try {
			const {sent} = await promise;
			sent.on('error', reject);
			sent.on('receipt', r => {
				if (!r.status)
					return reject('Transaction failed.');
				try {
					return accept(augmentReceipt(inst, address, r));
				} catch (err) {
					reject(err);
				}
			});
		} catch (err) {
			reject(err); throw err;
		}
	});
	wrapper.receipt = wrapper;
	// Create a promise that resolves with the transaction hash.
	wrapper.txId = new Promise(async (accept, reject) => {
		try {
			const {sent} = await promise;
			sent.on('error', reject);
			sent.on('transactionHash', accept);
		} catch (err) {
			reject(err); throw err;
		}
	});
	// Create a function that creates a promise that resolves after a number of
	// confirmations.
	wrapper.confirmed = (count) => {
			count = count || 1;
			// If we've already seen the confirmation, resolve immediately.
			if (confirmations >= count) {
				assert(receipt);
				return Promise.resolve(receipt);
			}
			// Create a promise that'll get called by the confirmation handler.
			return new Promise((accept, reject) => {
				promise.catch(reject);
				promise.then(sent => {
					sent.on('error', reject);
					sent.on('confirmation', (_count, receipt) => {
						if (_count == count)
							accept(receipt);
					});
				});
			});
		};
	return wrapper;
}

function decodeCallOutput(def, encoded) {
	const decoded = coder.decodeCallOutput(def, encoded);
	// Return a single value if only one type.
	if (def.outputs.length == 1)
		return decoded[0];
	return decoded;
}

function augmentReceipt(inst, address, receipt) {
	address = address || receipt.contractAddress || inst._address;
	address = ethjs.toChecksumAddress(address);
	// Parse logs into events.
	const groups = _.groupBy(receipt.logs, 'address');
	const events = [];
	for (let contract in groups) {
		const abi = (contract == address) ?
			inst._abi : module.exports.ABI_CACHE[contract];
		if (!abi)
			continue;
		for (let log of groups[contract]) {
			const decoded = decodeLogItem(abi, log);
			if (decoded)
				events.push(decoded);
		}
	}
	return _.assign(receipt, {
		findEvent: (name, args) => findEvent(name, args, events),
		findEvents: (name, args) => findEvents(name, args, events),
		events: events
	});
}

function decodeLogItem(abi, log) {
	const decoded = coder.decodeLogItemArgs(abi, log);
	return {
		name: decoded.name,
		args: decoded.args,
		address: log.address,
		blockNumber: log.blockNumber,
		logIndex: log.logIndex,
		transactionHash: log.transactionHash
	};
}

function findEvent(name, args, events) {
	args = args || {};
	for (let event of events) {
		if (name && event.name != name)
			continue;
		if (testEventArgs(event, args))
			return event;
	}
}

function findEvents(name, args, events) {
	args = args || {};
	const found = [];
	for (let event of events) {
		if (name && event.name != name)
			continue;
		if (testEventArgs(event, args))
			found.push(event);
	}
	return found;
}

async function getGasPrice(inst, opts) {
	const web3 = inst._web3;
	let gasPriceBonus = 0;
	if (_.isNumber(opts.gasPriceBonus))
		gasPriceBonus = opts.gasPriceBonus;
	if (_.isNumber(inst.gasPriceBonus))
		gasPriceBonus = inst.gasPriceBonus
	return new BigNumber(await web3.eth.getGasPrice())
		.times(1+(gasPriceBonus)).toString(10);
}

function createCallData(inst, def, args, opts) {
	const contract = inst._contract;
	const _args = arrangeCallArgs(args, def);
	if (def.type == 'constructor') {
		const bytecode = opts.bytecode || inst.bytecode;
		if (!bytecode)
			throw new Error('Contract has no bytecode defined and it was not provided.');
		return inst._contract.deploy(
				{data: util.addHexPrefix(bytecode), arguments: _args})
			.encodeABI();
	}
	return inst._contract.methods[def.name](..._args).encodeABI();
}

function arrangeCallArgs(args, def, opts={}) {
	const inputs = def.inputs;
	if (!opts.partial)
		assert.equal(_.uniq(_.keys(args)).length, inputs.length);
	let r = [];
	if (_.isArray(args)) {
		for (let i = 0; i < inputs.length; i++) {
			if (opts.indexedOnly && !inputs[i].indexed)
				continue;
			r.push(args[i]);
		}
	} else if (_.isPlainObject(args)) {
		for (let i = 0; i < inputs.length; i++) {
			if (opts.indexedOnly && !inputs[i].indexed)
				continue;
			const name = inputs[i].name;
			if (name in args)
				r.push(args[name]);
			else
				r.push(null);
		}
	}
	if (opts.partial)
		r = [...r, ..._.times(inputs.length - r.length, () => null)];
	return r;
}

function parseMethodCallArgs(args) {
	if (args.length > 0) {
		const last = _.last(args);
		if (_.isPlainObject(last)) {
			if (args.length > 1)
				return {args: _.initial(args), opts: last};
			return {args: last.args || [], opts: _.omit(last, ['args'])};
		}
	}
	return {args: args, opts: {}};
}

function createProvider(opts) {
	const uri = opts.providerURI ||
		createProviderURI(opts.network, opts.infuraKey);
	if (/^https?:\/\/.+$/.test(uri))
		return new Web3.providers.HttpProvider(uri);
	if (/^ws:\/\/.+$/.test(uri))
		return new Web3.providers.WebsocketProvider(uri);
	if (!opts.net)
		throw new Error(`IPC transport requires 'net' option.`);
	return new Web3.providers.IpcProvider(uri, opts.net);
}

function createProviderURI(network, infuraKey) {
	network = network || 'main';
	infuraKey = infuraKey || createInfuraKey();
	if (network == 'main')
		network = 'mainnet';
	return `https://${network}.infura.io/${infuraKey}`;
}

function createInfuraKey() {
	const symbols =
		'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
	return _.times(20, () => symbols[_.random(0, symbols.length-1)]).join('');
}
