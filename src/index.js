'use strict'
const _ = require('lodash');
const Web3 = require('web3');
const ethjs = require('ethereumjs-util');
const ethjstx = require('ethereumjs-tx');
const ethjsabi = require('ethjs-abi');
const BigNumber = require('bignumber.js');

module.exports = class {
	constructor(abi, opts={}) {
		const provider = opts.provider || createProvider(opts);
		const web3 = this.web3 = opts.web3 || new Web3(provider);
		this._chainId = web3.eth.net.getId();
		const _abi = this.abi = abi.abi || abi.abiDefinition || abi;
		const logDecoder = this._logDecoder = ethjsabi.logDecoder(_abi);
		const bytecode = this.bytecode =
			opts.bytecode || abi.bytecode || abi.code || abi.binary || null;
		const address = this._address = opts.address ?
			pts.address.toLowerCase() : undefined;
		this.contract = new web3.eth.Contract(_abi, opts.address);
		initMethods(this, _abi);
		initEvents(this, _abi);
		if (address)
			module.exports.DECODERS[address] = logDecoder;
	}

	async new(..._args) {
		const {args, opts} = parseMethodCallArgs(_args);
		const schema = findSchema(this.abi, {type: 'constructor', args: args});
		if (!schema)
			throw new Error(`Cannot find matching constructor for given arguments`);
		const r = await sendTx(this, schema, args, opts);
		// Set address and cache the decoder on successful deploy.
		r.receipt.then(
			receipt => {
				const addr = receipt.contractAddress.toLowerCase();
				this._address = addr;
				module.exports.DECODERS[addr] = this._logDecoder;
			});
		return r;
	}

	get address() {
		return this._address;
	}

	set address(v) {
		if (v)
			this._address = v.toLowerCase();
		else
			this._address = undefined;
	}
};
module.exports.DECODERS = {};
module.exports.MAX_GAS = 6721975;

function findSchema(schemas, filter={}) {
	for (let schema of schemas) {
		if (filter.name && schema.name != filter.name)
			continue;
		if (filter.type && schema.type != filter.type)
			continue;
		if (filter.args) {
			if (_.isArray(filter.args)) {
				if (schema.inputs.length != filter.args.length)
					continue;
			} else if (_.isPlainObject(filter.args)) {
				const keys = _.keys(filter.args);
				if (schema.inputs.length != keys.length)
					continue;
				const inputNames = _.map(schema.inputs, i => i.name);
				if (_.difference(keys, inputNames).length)
					continue;
			}
		} else {
			if (schema.inputs.length != 0)
				continue;
		}
		return schema;
	}
}

function initMethods(inst, abi) {
	for (let schema of abi) {
		if (schema.type == 'function') {
			const name = schema.name;
			const schemas = _.get(inst, [name, '_schemas'], []);
			const handler = inst[name] = inst[name] ||
				async function (..._args) {
					const {args, opts} = parseMethodCallArgs(_args);
					const schema = findSchema(schemas, {args: args});
					if (!schema)
						throw new Error(`Cannot find matching function '${name}' for given arguments`);
					if (schema.constant)
						return callTx(this, schema, args, opts);
					return sendTx(this, schema, args, opts);
				};
			schemas.push(schema);
			handler._schemas = schemas;
		}
	}
}

function initEvents(inst, abi) {
	for (let schema of abi) {
		if (schema.type == 'event') {
			const name = schema.name;
			const handler = inst[name] = inst[name] ||
				async function (opts) {
					return watchEvents(this, schema, opts);
				};
		}
	}
}

async function createCallOpts(inst, schema, args, opts) {
	const web3 = inst.web3;
	const data = opts.data || createCallData(inst, schema, args);
	const from = opts.from ||
		(opts.key ? privateKeyToAddress(opts.key) : undefined) ||
		web3.eth.defaultAccount || await getFirstAccount(web3);
	console.log(from);
	const chainId = opts.chainId || await inst._chainId;
	const gasPrice = opts.gasPrice || await getGasPrice(inst);
	const gasLimit = opts.gas || opts.gasLimit ||
		await estimateGas(inst, schema, args, opts);
	const value = opts.value || 0;
	const to = opts.to || inst.address;
	const _opts = {
		chainId: chainId,
		gasPrice: toHex(gasPrice),
		gasLimit: toHex(gasLimit),
		value: toHex(value),
		data: data || '0x'
	};
	if (to)
		_opts.to = to.toLowerCase();
	if (from)
		_opts.from = _.isString(from) ? from.toLowerCase() : from;
	return _opts;
}

async function estimateGas(inst, schema, args, opts) {
	opts = _.assign({}, opts, {
			gasPrice: 1,
			gasLimit: module.exports.MAX_GAS,
		});
	const _opts = await createCallOpts(inst, schema, args, opts);
	if (!_opts.from)
		throw Error('Cannot determine caller.');
	const gas = await inst.web3.eth.estimateGas(_opts, _opts.block);
	return Math.ceil(gas * (1+(inst.gasBonus || 0)));
}

async function callTx(inst, schema, args, opts) {
	opts = _.assign({}, opts, {
			gasPrice: 1,
			gasLimit: module.exports.MAX_GAS,
		});
	const _opts = await createCallOpts(inst, schema, args, opts);
	return decodeCallOutput(
		await inst.web3.eth.call(_opts, _opts.block), schema);
}

async function sendTx(inst, schema, args, opts) {
	opts = _.assign({}, opts, {
			gasPrice: opts.gasPrice || await getGasPrice(inst),
			gasLimit: opts.gasLimit || await estimateGas(inst, schema, args, opts),
		});
	const _opts = await createCallOpts(inst, schema, args, opts);
	if (!_opts.from)
		throw Error('Cannot determine caller.');
	if (!_opts.to && schema.type != 'constructor')
		throw Error('Contract has no address.');
	let sent = null;
	if (opts.key)  {
		// Send through an explicit private key.
		const tx = new ethjstx(_opts)
		tx.sign(ethjs.toBuffer(opts.key));
		sent = inst.web3.eth.sendSignedTransaction(toHex(tx.serialize()));
	} else {
		// Let the provider sign it.
		sent = inst.web3.eth.sendTransaction(_opts);
	}
	return wrapSentTx(inst, sent);
}

async function getFirstAccount(web3) {
	const accts = await web3.eth.getAccounts();
	if (accts && accts.length)
		return accts[0];
}

function wrapSentTx(inst, sent) {
	return new Promise((accept, reject) => {
		sent.once('error', reject);
		sent.once('transactionHash', txHash => {
			accept({
				txId: txHash,
				receipt: new Promise((_accept, _reject) => {
					sent.once('error', _reject);
					sent.once('receipt', r => {
						if (!r.status)
							return _reject('Transaction failed.');
						return _accept(decodeReceipt(inst, r));
					});
				})
			});
		});
	});
}

function decodeCallOutput(encoded, schema) {
	const types = _.map(schema.outputs, o => o.type);
	const decoded = ethjsabi.decodeParams(types, encoded);
	// Convert BNs to strings.
	return _.map(decoded, normalizeDecodedParam);
}

function normalizeDecodedParam(v) {
	if (_.isArray(v))
		return _.map(v, normalizeDecodedParam);
	if (_.isFunction(v.toString))
		return v.toString(10);
	return v;
}

function decodeReceipt(inst, receipt) {
	// Parse logs into events.
	const groups = _.mapKeys(_.groupBy(receipt.logs, 'address'),
		(v,k) => k.toLowerCase());
	const events = [];
	for (let contract in groups) {
		const decoder = (contract == inst.address) ?
			inst._logDecoder : module.exports.DECODERS[contract];
		if (!decoder)
			continue;
		const decoded = decoder(groups[contract]);
		for (let event of decoded) {
			events.push({
				name: event._eventName,
				contract: contract,
				args: _.mapValues(_.omit(event, ['_eventName']), normalizeDecodedParam)
			});
		}
	}
	return _.assign(receipt, {
		findEvent: (name, args) => findEvent(name, args, events),
		events: events
	});
}

function findEvent(name, args, events) {
	args = args || {};
	for (let event of events) {
		if (name && event.name != name)
			continue;
		let found = true;
		for (let argName in args) {
			if (!(argName in event.args)) {
				found = false;
				break;
			}
			const a = event.args[argName];
			const b = args[argName]
			if (a != b && toHex(a) != toHex(b)) {
				found = false;
				break;
			}
		}
		if (found)
			return event;
	}
}

async function getGasPrice(inst) {
	const web3 = inst.web3;
	return new BigNumber(await web3.eth.getGasPrice())
		.times(1+(inst.gasPriceBonus || 0)).toString(10);
}

function toHex(v) {
	if (_.isNumber(v))
		return '0x'+(new ethjs.BN(v).toString(16));
	if (_.isString(v)) {
		if (v.startsWith('0x'))
			return v.toLowerCase();
		return '0x'+(new ethjs.BN(v).toString(16));
	}
	if (_.isBuffer(v))
		return ethjs.bufferToHex(v);
	throw new Error(`Can't convert value to hex: ${v}`);
}

function privateKeyToAddress(key) {
	let r = '0x'+(ethjs.privateToAddress(ethjs.toBuffer(key)).toString('hex'));
	console.log(key, r);
	return r;
}

function createCallData(inst, schema, args) {
	const contract = inst.contract;
	const _args = arrangeCallArgs(args, schema);
	if (schema.type == 'constructor') {
		if (!inst.bytecode)
			throw new Error('Contract has no bytecode defined.');
		return inst.contract.deploy({data: inst.bytecode, arguments: _args})
			.encodeABI();
	}
	return inst.contract.methods[schema.name](..._args).encodeABI();
}

function arrangeCallArgs(args, schema) {
	if (_.isArray(args))
		return args;
	return _.map(schema.inputs, i => args[i.name]);
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
