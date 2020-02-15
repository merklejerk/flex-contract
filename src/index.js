'use strict'
const _ = require('lodash');
const ethjs = require('ethereumjs-util');
const FlexEther = require('flex-ether');
const coder = require('./coder');
const util = require('./util');
const BigNumber = require('bignumber.js');
const EventEmitter = require('events');
const assert = require('assert');

const NULL_ADDRESS = '0x0000000000000000000000000000000000000000';

module.exports = class FlexContract {
	constructor(abi, address, opts) {
		// address may be omitted.
		if (_.isNil(opts)) {
			if (_.isPlainObject(address))
				opts = address;
			else
				opts = {};
		}
		if (_.isString(address))
			opts = _.assign({}, opts, {address: address});
		if (abi instanceof FlexContract) {
			// Clone.
			return this._copy(abi, opts)
		}
		this._eth = opts.eth || new FlexEther(opts);
		this._abi = abi.abi || abi.abiDefinition || abi.interface || abi;
		if (_.isString(this._abi))
			this._abi = JSON.parse(this._abi);
		this.bytecode = opts.bytecode || abi.bytecode || abi.code
			|| abi.binary || null;
		this.address = opts.address;
		initMethods(this, this._abi);
		initEvents(this, this._abi);
		populateEventCache(this._abi.filter(e => e.type === 'event'));
	}

	_copy(inst, opts={}) {
		if (opts.eth) {
			this._eth = opts.eth;
		} else if (opts.provider ||
				opts.providerURI || opts.network || opts.infuraKey) {
			this._eth = new FlexEther(opts);
		} else {
			this._eth = inst._eth;
		}
		this._abi = inst._abi;
		this.address = opts.address || inst._address;
		this.bytecode = opts.bytecode || inst.bytecode;
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

	get eth() {
		return this._eth;
	}

	set eth(v) {
		this._eth = v;
	}

	get gasBonus() {
		return this._eth.gasBonus;
	}

	set gasBonus(v) {
		return this._eth.gasBonus = v;
	}

	get gasPriceBonus() {
		return this._eth.gasPriceBonus;
	}

	set gasPriceBonus(v) {
		return this._eth.gasPriceBonus = v;
	}

	get address() {
		return this._address;
	}

	set address(v) {
		if (_.isString(v)) {
			if (ethjs.isValidAddress(v)) {
				this._address = ethjs.toChecksumAddress(v);
			} else {
				this._address = v;
			}
		} else
			this._address = undefined;
	}

	async getCodeDigest(opts={}) {
		return getCodeDigest(this, opts);
	}

	new(...args) {
		const def = findDef(this._abi, {type: 'constructor', args: args});
		if (!def)
			throw new Error(`Cannot find matching constructor for given arguments`);
		const _call = createBoundFunctionCall(this, def, args);
		// Wrap `send()` to automatically set the contract address on deploy.
		const _oldSend = _call.send;
		_call.send = (...sendArgs) => {
			const sendPromise = _oldSend.call(this, ...sendArgs);
			sendPromise.receipt.then(receipt => {
				this._address = ethjs.toChecksumAddress(
					receipt.contractAddress,
				);
			});
			return sendPromise;
		};
		return _call;
	}
};
const EVENT_CACHE = module.exports.EVENT_CACHE = {};
module.exports.ens = FlexEther.ens;

class EventWatcher extends EventEmitter {
	constructor(opts) {
		super();
		this._inst = opts.inst;
		this._def = opts.def;
		this.pollRate = opts.pollRate;
		this._timer = null;
		this._stop = false;
		this.stop = this.close;
		this._args = opts.args || {};
		this._init(opts.address || inst._address);
	}

	async _init(address) {
		try {
			const eth = this._inst._eth;
			const indexedArgs = await resolveCallArgs(
				this._inst,
				this._args,
				this._def,
				{ partial: true, indexedOnly: true },
			);
			this._filter = {
				address,
				topics: coder.encodeLogTopicsFilter(this._def, indexedArgs)
			};
			this._lastBlock = await eth.getBlockNumber();
			if (!this._stop)
				this._timer = setTimeout(() => this._poll(), this.pollRate);
		} catch (err) {
			this.emit('error', err);
		}
	}

	async _poll() {
		if (this._stop || _.isNil(this._lastBlock))
			return;
		try {
			const eth = this._inst._eth;
			const currentBlock = await eth.getBlockNumber();
			if (currentBlock > this._lastBlock) {
				const filter = {
					...this._filter,
					fromBlock: this._lastBlock + 1,
					toBlock: currentBlock,
				};
				const raw = await eth.getPastLogs(filter);
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
	const address = await inst._eth.resolve(opts.address || opts.to);
	if (!address)
		throw new Error('Cannot determine contract adress and it was not provided.');
	const code = await inst._eth.getCode(address, opts.block);
	return util.toHex(ethjs.keccak256(
		Buffer.from(util.stripHexPrefix(code), 'hex')));
}

function findDef(defs, filter={}) {
	// Sort functions descending input length to match longest function call
	// first .
	const sortedDefs = defs.slice().sort((a, b) => {
		return (b.inputs || []).length - (a.inputs || []).length;
	});
	for (let def of sortedDefs) {
		if (filter.name && def.name != filter.name)
			continue;
		if (filter.type && def.type != filter.type)
			continue;
		if (filter.args) {
			const args = filter.args;
			if (_.isArray(args)) {
				if (args.length == 1) {
					if (def.inputs.length == 0)
						continue;
					// Handle named args.
					if (def.inputs.length > 1) {
						if (_.isObject(args[0])) {
							if (!def.inputs.every(i => args[0][i.name] !== undefined))
								continue;
						} else if (def.inputs.length !== args.length)
							continue;
					}
				} else if (def.inputs.length !== args.length)
					continue;
			} else if (_.isObject(args)) {
				if (!def.inputs.every(i => args[i.name] !== undefined))
					continue;
			}
		} else if (def.inputs.length != 0) {
			continue;
		}
		return def;
	}
	if (filter.type === 'constructor' && (!filter.args || filter.args.length === 0)) {
		return {
			type: 'constructor',
			inputs: [],
			outputs: [],
		};
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
				function (...args) {
					const def = findDef(_defs, {args: args});
					if (!def)
						throw new Error(`Cannot find matching function '${name}' for given arguments`);
					return createBoundFunctionCall(inst, def, args);
				};
		}
	}
}

function createBoundFunctionCall(inst, def, args) {
	const parsedArgs = parseFunctionArgs(def, args);
	return {
		gas(opts = {}) {
			return estimateGasBoundFunction(inst, def, parsedArgs, opts);
		},
		call(opts = {}) {
			return callBoundFunction(inst, def, parsedArgs, opts);
		},
		async encode(opts = {}) {
			return (await createCallOpts(inst, def, parsedArgs, { to: NULL_ADDRESS, ...opts })).data;
		},
		send(opts = {}) {
			return sendBoundFunction(inst, def, parsedArgs, opts);
		},
	};
}

function parseFunctionArgs(def, args) {
	if (def.inputs.length > 1 && args.length == 1 && _.isPlainObject(args[0])) {
		const argsObj = args[0];
		if (def.inputs.length === 1) {
			return [argsObj];
		}
		return def.inputs.map(input => {
			if (!(input.name in argsObj)) {
				throw new Error(`Function argument "${input.name}" missing from args object.`);
			}
			return argsObj[input.name];
		});
	}
	if (args.length !== def.inputs.length) {
		throw new Error(`Expected ${def.inputs.length} function args but instead got ${args.length}.`);
	}
	return args;
}

function initEvents(inst, abi) {
	const defs = {};
	for (let def of abi) {
		if (def.type == 'event') {
			const name = def.name;
			const _defs = defs[name] = defs[name] || [];
			_defs.push(def);
			const handler = inst[name] = inst[name] || function (...args) {
				const def = findDef(_defs, {args: args});
				if (!def)
					throw new Error(`Cannot find matching function '${name}' for given arguments`);
				return createBoundEventCall(inst, def, args);
			};
		}
	}
}

function createBoundEventCall(inst, def, args) {
	const parsedArgs = parseFunctionArgs(def, args);
	return {
		since(opts = {}) {
			return getPastEvents(inst, def, parsedArgs, opts);
		},
		watch(opts = {}) {
			return watchEvents(inst, def, parsedArgs, opts);
		},
	};
}

function populateEventCache(eventDefs) {
	for (const eventDef of eventDefs) {
		EVENT_CACHE[coder.encodeLogSignature(eventDef)] = eventDef;
	}
}

async function getPastEvents(inst, def, args, opts={}) {
	opts = _.defaults({}, opts, {
		fromBlock: -1,
		toBlock: -1,
		address: inst._address,
		args: {}
	});
	if (!opts.address)
		throw new Error('Contract does not have an address set and it was not provided.');
	const topicsArgs = await resolveCallArgs(
		inst,
		args || {},
		def,
		{ partial: true, indexedOnly: true },
	);
	const filter = {
		fromBlock: opts.fromBlock,
		toBlock: opts.toBlock,
		address: opts.address,
		topics: coder.encodeLogTopicsFilter(def, topicsArgs)
	};
	const raw = await inst._eth.getPastLogs(filter);
	return _.filter(
		_.map(
			raw,
			_raw => decodeLogItem(def, _raw),
		),
		log => testEventArgs(log, args),
	);
}

function watchEvents(inst, def, args, opts) {
	opts = _.defaults(
		{},
		opts,
		{
			address: inst._address,
			args: {},
			pollRate: 15000
		},
	);
	if (!opts.address)
		throw new Error('Contract does not have an address set and it was not provided.');
	return new EventWatcher({
		args,
		inst: inst,
		address: opts.address,
		pollRate: opts.pollRate,
		def: def
	});
}

function testEventArgs(log, args={}) {
	return _.every(
		_.map(
			// Args can be an array and this will work because event args can
			// be indexed by offset as well.
			_.keys(args),
			name => _.isNil(args[name])
				|| util.isSameValue(log.args[name], args[name]),
		),
	);
}

async function createCallOpts(inst, def, args, opts) {
	let to = undefined;
	if (def.type != 'constructor') {
		to = await inst._eth.resolve(
			opts.to || opts.address || inst.address);
	}
	const data = opts.data || await createCallData(inst, def, args, opts);
	return {
		gasPrice: opts.gasPrice,
		gasLimit: opts.gasLimit | opts.gas,
		gasPriceBonus: opts.gasPriceBonus,
		gasBonus: opts.gasBonus,
		value: opts.value,
		data: data,
		to: to,
		from: opts.from
	};
}

async function estimateGasBoundFunction(inst, def, args, opts = {}) {
	const callOpts = await createCallOpts(inst, def, args, opts);
	callOpts.key = opts.key;
	return inst._eth.estimateGas(callOpts.to, callOpts);
}

async function callBoundFunction(inst, def, args, opts) {
	const callOpts = await createCallOpts(inst, def, args, opts);
	callOpts.block = opts.block;
	callOpts.key = opts.key;
	if (!callOpts.to && def.type != 'constructor')
		throw Error('Contract has no address.');
	const result = await inst._eth.call(callOpts.to, callOpts);
	return decodeCallOutput(def, result);
}

function sendBoundFunction(inst, def, args, opts = {}) {
	return wrapSendTxPromise((async () => {
		const callOpts = await createCallOpts(inst, def, args, opts);
		callOpts.key = opts.key;
		if (!callOpts.to && def.type != 'constructor')
			throw Error('Contract has no address.');
		const tx = inst._eth.send(callOpts.to, callOpts);
		return {tx: tx, address: callOpts.to, inst: inst};
	})());
}

function wrapSendTxPromise(sent) {
	let receipt = null;
	const wrapper = (async () => {
		if (receipt) {
			return receipt;
		}
		const { tx, address, inst } = await sent;
		return receipt = augmentReceipt(inst, address, await tx);
	})();
	wrapper.receipt = wrapper;
	wrapper.txId = (async () => {
		const {tx} = await sent;
		return await tx.txId;
	})();
	wrapper.confirmed = async (count=1) => {
		const { tx, address, inst } = await sent;
		const r = await tx.confirmed(count);
		if (receipt) {
			return receipt;
		}
		return receipt = augmentReceipt(inst, address, r);
	};
	return wrapper;
}

function decodeCallOutput(def, encoded) {
	const decoded = coder.decodeCallOutput(def.outputs, encoded);
	// Return a single value if only one type.
	if (def.outputs.length == 1)
		return decoded[0];
	return decoded;
}

function augmentReceipt(inst, address, receipt) {
	address = ethjs.toChecksumAddress(
		address || receipt.contractAddress || receipt.to);
	// Parse logs into events.
	const events = [];
	for (const log of receipt.logs) {
		for (const signature in EVENT_CACHE) {
			if (log.topics.length == 0) {
				continue;
			}
			if (util.isSameHex(log.topics[0], signature)) {
				const decoded = decodeLogItem(EVENT_CACHE[signature], log);
				if (decoded) {
					events.push(decoded);
				}
			}
		}
	}
	return _.assign(receipt, {
		findEvent: (name, args) => findEvent(name, args, events),
		findEvents: (name, args) => findEvents(name, args, events),
		events: events
	});
}

function decodeLogItem(def, log) {
	const args = coder.decodeLogItemArgs(def, log);
	return {
		name: def.name,
		args: args,
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

async function createCallData(inst, def, args, opts) {
	const _args = await resolveCallArgs(inst, args, def);
	if (def.type == 'constructor') {
		const bytecode = opts.bytecode || inst.bytecode;
		if (!bytecode)
			throw new Error('Contract has no bytecode defined and it was not provided.');
		return coder.encodeConstructorCall(bytecode, def, _args);
	}
	return coder.encodeFunctionCall(def, _args);
}

async function resolveCallArgs(inst, args, def, opts={}) {
	const inputs = def.inputs;
	if (!opts.partial)
		assert.equal(_.uniq(_.keys(args)).length, inputs.length);
	let r = [];
	if (_.isArray(args)) {
		for (let i = 0; i < inputs.length; i++) {
			const input = inputs[i];
			if (opts.indexedOnly && !input.indexed)
				continue;
			if (/^address/.test(input.type))
				r.push(await resolveAddresses(inst, args[i]));
			else
				r.push(args[i]);
		}
	} else if (_.isPlainObject(args)) {
		for (let i = 0; i < inputs.length; i++) {
			const input = inputs[i];
			if (opts.indexedOnly && !input.indexed)
				continue;
			const name = input.name;
			if (name in args) {
				if (/^address/.test(input.type))
					r.push(await resolveAddresses(inst, args[name]));
				else
					r.push(args[name]);
			}
			else
				r.push(null);
		}
	}
	if (opts.partial)
		r = [...r, ..._.times(inputs.length - r.length, () => null)];
	return r;
}

async function resolveAddresses(inst, v) {
	if (_.isArray(v))
		return Promise.all(_.map(v, _v => resolveAddresses(inst, _v)));
	if (_.isString(v))
		return inst._eth.resolve(v);
	return v;
}
