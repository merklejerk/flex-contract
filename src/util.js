'use strict'
const _ = require('lodash');
const ethjs = require('ethereumjs-util');

function stripHexPrefix(v) {
	if (v.startsWith('0x'))
		return v.substr(2);
	return v;
}

function addHexPrefix(v) {
	if (v.startsWith('0x'))
		return v;
	return '0x'+v;
}

function toHex(v) {
	if (_.isNumber(v))
		return '0x'+(new ethjs.BN(v).toString(16));
	if (_.isString(v)) {
		if (v.startsWith('0x'))
			return v.toLowerCase();
		return '0x'+(new ethjs.BN(v).toString(16));
	}
	if (_.isBuffer(v) || _.isArrayLike(v))
		return ethjs.bufferToHex(v);
	throw new Error(`Can't convert value to hex: ${v}`);
}

function privateKeyToAddress(key) {
	return ethjs.toChecksumAddress(
		'0x'+(ethjs.privateToAddress(ethjs.toBuffer(key)).toString('hex')));
}

module.exports = {
	stripHexPrefix: stripHexPrefix,
	addHexPrefix: addHexPrefix,
	toHex: toHex,
	privateKeyToAddress: privateKeyToAddress
};
