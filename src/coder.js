'use strict'
const _ = require('lodash');
const Web3 = require('web3');
const assert = require('assert');
const ethjs = require('ethereumjs-util');

const _coder = (new Web3()).eth.abi;

function encodeLogTopicsFilter(def, args=[]) {
	const topicArgs = [];
	assert(def.inputs.length == args.length);
	for (let i = 0; i < args.length; i++) {
		if (def.inputs[i].indexed) {
			if (!_.isNil(args[i]))
				topicArgs.push(encodeParameter(def.inputs[i].type, args[i]));
			else
				topicArgs.push(null);
		}
	}
	return [_coder.encodeEventSignature(def), ...topicArgs];
}

function decodeCallOutput(outputs, data) {
	return normalizeDecodedOutput(
		outputs,
		_coder.decodeParameters(outputs, data));
}

function encodeLogSignature(def) {
	return _coder.encodeEventSignature(def);
}

function decodeLogItemArgs(def, log) {
	return normalizeDecodedOutput(
		def.inputs,
		_coder.decodeLog(
			def.inputs,
			log.data,
			log.topics.slice(1)));
}

function encodeParameter(type, value) {
	assert(!_.isNil(value));
	return _coder.encodeParameter(type, normalizeEncodeValue(type, value));
}

function normalizeDecodedOutput(outputs, decoded) {
	for (let i = 0; i < outputs.length; i++) {
		const o = outputs[i];
		let v = decoded[i];
		if (o.type == 'tuple')
			v = normalizeDecodedOutput(o.components, v);
		else
			v = normalizeDecodedValue(o.type, v);
		if (o.name)
			decoded[o.name] = v;
		decoded[i] = v;
	}
	return decoded;
}

function normalizeDecodedValue(type, value) {
	if (_.isArray(value))
		return _.map(value, v => normalizeDecodedValue(type, v));
	const elementType = /^[a-z0-9]+/i.exec(type)[0];
	assert(elementType);
	// Convert addresses to checksummed addresses.
	if (elementType == 'address')
		return ethjs.toChecksumAddress(value);
	// Convert integers to strings.
	if (/^u?int/.test(elementType) && _.isObject(value))
		return value.toString(10);
	return value;
}

function normalizeEncodeValue(type, value) {
	if (_.isArray(value))
		return _.map(value, v => normalizeDecodedValue(type, v));
	const elementType = /^[a-z0-9]+/i.exec(type)[0];
	assert(elementType);
	if (elementType == 'address')
		return ethjs.toChecksumAddress(value);
	// Convert big number objects to strings.
	if (/^u?int/.test(elementType)
			&& _.isObject(value) && _.isFunction(value.toString))
		return value.toString(10);
	return value;
}

module.exports = {
	encodeLogSignature: encodeLogSignature,
	decodeLogItemArgs: decodeLogItemArgs,
	decodeCallOutput: decodeCallOutput,
	encodeLogTopicsFilter: encodeLogTopicsFilter,
};
