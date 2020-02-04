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

function isSameHex(a, b) {
	return a.toLowerCase() === b.toLowerCase();
}

function isSameValue(a, b) {
	if (_.isArray(a)) {
		if (!_.isArray(b)) {
			return false;
		}
		return a.every((v, i) => isSameValue(v, b[i]));
	} else if (_.isArray(b)) {
		return false;
	}
	if (_.isPlainObject(a)) {
		if (!_.isPlainObject(b)) {
			return false;
		}
		return Object.keys(a).every(k => isSameValue(a[k], b[k]));
	} else if (_.isPlainObject(b)) {
		return false;
	}
	return a.toString() === b.toString();
}

module.exports = {
	stripHexPrefix,
	addHexPrefix,
	toHex,
	isSameHex,
	isSameValue,
};
