'use strict'
const _ = require('lodash');
const Web3 = require('web3');
const keccak256 = Web3.utils.keccak256;
const assert = require('assert');
const coder = require('./lib/web3.js/lib/solidity/coder')
const util = require('./util');

function encodeLogSignature(eventABI) {
	const args = _.map(eventABI.inputs, i => i.type).join(',');
	const textSig = `${eventABI.name}(${args})`;
	return keccak256(Buffer.from(textSig));
}

function encodeLogTopicsFilter(eventABI, args=[]) {
	const topicArgs = [];
	assert(eventABI.inputs.length == args.length);
	for (let i = 0; i < args.length; i++) {
		if (eventABI.inputs[i].indexed) {
			if (!_.isNil(args[i]))
				topicArgs.push(encodeValue(eventABI.inputs[i].type, args[i]));
			else
				topicArgs.push(null);
		}
	}
	return [encodeLogSignature(eventABI), ...topicArgs];
}

function encodeValue(type, v) {
	assert(!_.isNil(v));
	return util.addHexPrefix(coder.encodeParam(type, v));
}

function encodePackedValues(types, values) {
	assert(types.length == values.length);
	return util.addHexPrefix(coder.encodeParams(types, values));
}

function decodeValue(type, v) {
	v = util.stripHexPrefix(v);
	return normalizeDecodedValue(type, coder.decodeParam(type, v));
}

function decodeList(types, values) {
	assert(types.length == values.length);
	values = _.map(values, util.stripHexPrefix);
	return _.times(types.length, i => decodeValue(types[i], values[i]));
}

function decodePackedValues(types, v) {
	v = util.stripHexPrefix(v);
	const r = _.map(coder.decodeParams(types, v),
		(v,i) => normalizeDecodedValue(types[i], v));
	assert(r.length == types.length);
	return r;
}

function normalizeDecodedValue(type, v) {
	if (type == 'address')
		return v.toLowerCase();
	if (/^u?int\d+$/.test(type) && _.isObject(v))
		return v.toString(10);
	if (_.isArray(v)) {
		const elementType = /^(.+)\[\]$/.exec(type)[1];
		assert(elementType);
		return _.map(v, _v => normalizeDecodedValue(elementType, _v));
	}
	return v;
}

function decodeLogItemArgs(abi, log) {
	if (_.isArray(abi)) {
		for (let s of abi) {
			if (s.type =='event') {
				const r = decodeLogItemArgs(s, log);
				if (r)
					return r;
			}
		}
	} else if (abi.type == 'event' && log.topics[0] == encodeLogSignature(abi)) {
		const indexedTypes = _.map(
			_.filter(abi.inputs, i => i.indexed), i => i.type);
		const nonIndexedTypes = _.map(
			_.filter(abi.inputs, i => !i.indexed), i => i.type);
		const indexedValues = decodeList(indexedTypes, log.topics.slice(1));
		const nonIndexedValues = decodePackedValues(nonIndexedTypes, log.data);
		let i = 0; let j = 0;
		const args = {};
		for (let k = 0; k < abi.inputs.length; k++) {
			const input = abi.inputs[k];
			let v = null;
			if (input.indexed)
				v = indexedValues[i++];
			else
				v = nonIndexedValues[j++];
			if (input.name)
				args[input.name] = v;
			args[k] = v;
		}
		return {
			name: abi.name,
			args: args
		};
	}
}

function decodeCallOutput(fnABI, data) {
	const outputs = fnABI.outputs;
	const values = decodePackedValues(_.map(outputs, o => o.type), data);
	assert(outputs.length == values.length);
	const r = {};
	for (let i = 0; i < outputs.length; i++) {
		const output = outputs[i];
		const v = values[i];
		if (output.name)
			r[output.name] = v;
		r[i] = v;
	}
	return r;
}


module.exports = {
	decodeLogItemArgs: decodeLogItemArgs,
	decodeValue: decodeValue,
	decodePackedValues: decodePackedValues,
	decodeList: decodeList,
	decodeCallOutput: decodeCallOutput,
	normalizeDecodedValue: normalizeDecodedValue,
	encodeLogSignature: encodeLogSignature,
	encodeLogTopicsFilter: encodeLogTopicsFilter,
	encodeValue: encodeValue,
	encodePackedValues: encodePackedValues
};
