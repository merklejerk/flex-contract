'use strict'
const _ = require('lodash');
const abiEncoder = require('web3-eth-abi');
const assert = require('assert');
const ethjs = require('ethereumjs-util');
const util = require('./util');

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
	return [abiEncoder.encodeEventSignature(def), ...topicArgs];
}

function encodeFunctionCall(def, args=[]) {
	return abiEncoder.encodeFunctionCall(
		def,
		normalizeEncodeInput(def.inputs, args),
	);
}

function encodeConstructorCall(bytecode, def, args=[]) {
	return util.addHexPrefix(bytecode) +
		util.stripHexPrefix(abiEncoder.encodeParameters(
			def.inputs,
			normalizeEncodeInput(def.inputs, args),
		));
}

function decodeCallOutput(outputs, data) {
	return normalizeDecodedOutput(
		outputs,
		abiEncoder.decodeParameters(outputs, data));
}

function encodeLogSignature(def) {
	return abiEncoder.encodeEventSignature(def);
}

function decodeLogItemArgs(def, log) {
	return normalizeDecodedOutput(
		def.inputs,
		abiEncoder.decodeLog(
			def.inputs,
			log.data,
			log.topics.slice(1)));
}

function encodeParameter(type, value) {
	assert(!_.isNil(value));
	return abiEncoder.encodeParameter(type, normalizeEncodeValue(type, value));
}

function normalizeEncodeInput(inputs, values) {
	const normalized = [];
	for (let i = 0; i < inputs.length; i++) {
		const input = inputs[i];
		let v = _.isArray(values) ? values[i] : values[input.name];
		if (_.isNil(v)) {
			throw new Error(`Received nil value for input "${input.name}"`);
		}
		if (input.type == 'tuple')
			v = normalizeEncodeInput(input.components, v);
		else
			v = normalizeEncodeValue(input.type, v);
		normalized.push(v);
	}
	return normalized;
}

function normalizeDecodedOutput(outputs, decoded) {
	const normalized = {};
	for (let i = 0; i < outputs.length; i++) {
		const output = outputs[i];
		let v = decoded[i];
		if (output.type == 'tuple')
			v = normalizeDecodedOutput(output.components, v);
		else
			v = normalizeDecodedValue(output.type, v);
		if (output.name)
			normalized[output.name] = v;
		normalized[i] = v;
	}
	return normalized;
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
	// Resize bytes values.
	const m = /^bytes(\d+)?$/.exec(elementType);
	if (m && m[1]) {
		const size = parseInt(m[1]);
		return ethjs.bufferToHex(ethjs.setLengthRight(value, size));
	}
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
	// Resize bytes values.
	const m = /^bytes(\d+)?$/.exec(elementType);
	if (m && m[1]) {
		const size = parseInt(m[1]);
		return ethjs.bufferToHex(ethjs.setLengthRight(value, size));
	}
	return value;
}

module.exports = {
	encodeLogSignature: encodeLogSignature,
	decodeLogItemArgs: decodeLogItemArgs,
	decodeCallOutput: decodeCallOutput,
	encodeLogTopicsFilter: encodeLogTopicsFilter,
	encodeFunctionCall: encodeFunctionCall,
	encodeConstructorCall: encodeConstructorCall,
};
