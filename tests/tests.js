'use strict'
const ganache = require('ganache-cli');
const FlexContract = require('../src/index');
const promisify = require('util').promisify;
const fs = require('mz/fs');
const ABI = require('./contracts/TestContract.abi.json');
const BYTECODE = require('./contracts/TestContract.bytecode.json');
const assert = require('assert');
const crypto = require('crypto');
const ethjs = require('ethereumjs-util');

describe('flex-contract', function() {
	let _ganache = null;
	let provider = null;
	let accounts = null;

	before(async function() {
		accounts = _.times(16, () => ({
			secretKey: crypto.randomBytes(32),
			balance: 100 + _.repeat('0', 18)
		}));
		_ganache = ganache.server({
			accounts: accounts
		});
		await promisify(_ganache.listen)(8545);
		provider = _ganache.provider;
		provider.setMaxListeners(1024);
	});

	after(async function() {
		await promisify(_ganache.close)();
	});

	it('can deploy', async function() {
		const c = new FlexContract(ABI, {provider: provider, bytecode: BYTECODE});
		const {txId, receipt: _receipt} = await c.new();
		assert.ok(txId);
		const receipt = await _receipt;
		assert.ok(receipt.contractAddress);
		assert.ok(c.address);
	});

	it('can call constant functions', async function() {
		const c = new FlexContract(ABI, {provider: provider, bytecode: BYTECODE});
		await (await c.new()).receipt;
		assert.equal((await c.constFn()), 1);
		assert.equal((await c.constFn(1)), 2);
		assert.equal((await c.constFn(1, 2)), 3);
		const addr = '0x'+crypto.randomBytes(20).toString('hex');
		assert.equal((await c.echoAddress(addr)), addr);
	});

	it('can call constant functions with named args', async function() {
		const c = new FlexContract(ABI, {provider: provider, bytecode: BYTECODE});
		await (await c.new()).receipt;
		assert.equal((await c.constFn({args:{}})), 1);
		assert.equal((await c.constFn({args:{a: 1}})), 2);
		assert.equal((await c.constFn({args:{a: 1, b: 2}})), 3);
		const addr = '0x'+crypto.randomBytes(20).toString('hex');
		assert.equal((await c.echoAddress({args: {a: addr}})), addr);
	});

	it('can transact', async function() {
		const c = new FlexContract(ABI, {provider: provider, bytecode: BYTECODE});
		await (await c.new()).receipt;
		const {txId, receipt: _receipt} = await c.transact();
		assert.ok(txId);
		const receipt = await _receipt;
		assert.ok(receipt);
	});

	it('can transact and pay', async function() {
		const c = new FlexContract(ABI, {provider: provider, bytecode: BYTECODE});
		await (await c.new()).receipt;
		await (await c.transact({value: 100})).receipt;
		const bal = await c.web3.eth.getBalance(c.address);
		assert.equal(bal, 100);
	});

	it('can get a single receipt event', async function() {
		const c = new FlexContract(ABI, {provider: provider, bytecode: BYTECODE});
		await (await c.new()).receipt;
		const args = ['0x'+crypto.randomBytes(20).toString('hex'),
			_.random(1, 1e6), '0x'+crypto.randomBytes(32).toString('hex')];
		const receipt = await (await c.raiseEvent(...args)).receipt;
		const event = receipt.events[0];
		assert.equal(event.contract, c.address);
		assert.equal(event.name, 'SingleEvent');
		assert.equal(event.args.a, args[0]);
		assert.equal(event.args.b, args[1]);
		assert.equal(event.args.c, args[2]);
	});

	it('can get multiple receipt events', async function() {
		const c = new FlexContract(ABI, {provider: provider, bytecode: BYTECODE});
		await (await c.new()).receipt;
		const count = 3;
		const args = ['0x'+crypto.randomBytes(20).toString('hex'),
			_.random(1, 1e6), '0x'+crypto.randomBytes(32).toString('hex')];
		const receipt = await (await c.raiseEvents(count, ...args)).receipt;
		const events = receipt.events.sort((a,b) => a.args.idx - b.args.idx);
		for (let i = 0; i < events.length; i++) {
			const event = events[i];
			assert.equal(event.contract, c.address);
			assert.equal(event.name, 'RepeatedEvent');
			assert.equal(event.args.idx, i);
			assert.equal(event.args.a, args[0]);
			assert.equal(event.args.b, args[1]);
			assert.equal(event.args.c, args[2]);
		}
	});

	it('can find a receipt event with findEvent', async function() {
		const c = new FlexContract(ABI, {provider: provider, bytecode: BYTECODE});
		await (await c.new()).receipt;
		const count = 3;
		const args = ['0x'+crypto.randomBytes(20).toString('hex'),
			_.random(1, 1e6), '0x'+crypto.randomBytes(32).toString('hex')];
		const receipt = await (await c.raiseEvents(count, ...args)).receipt;
		const event = receipt.findEvent('RepeatedEvent',
			{idx: 1, a: args[0], b: args[1], c: args[2]});
		assert.equal(event.contract, c.address);
		assert.equal(event.name, 'RepeatedEvent');
		assert.equal(event.args.idx, 1);
		assert.equal(event.args.a, args[0]);
		assert.equal(event.args.b, args[1]);
		assert.equal(event.args.c, args[2]);
	});

	it('can get receipt event raised in other contract', async function() {
		const c1 = new FlexContract(ABI, {provider: provider, bytecode: BYTECODE});
		const c2 = new FlexContract(ABI, {provider: provider, bytecode: BYTECODE});
		await (await c1.new()).receipt;
		await (await c2.new()).receipt;
		const args = ['0x'+crypto.randomBytes(20).toString('hex'),
			_.random(1, 1e6), '0x'+crypto.randomBytes(32).toString('hex')];
		const receipt = await (await c1.callOther(c2.address, ...args)).receipt;
		const event = receipt.events[0];
		assert.equal(event.contract, c2.address);
		assert.equal(event.name, 'SingleEvent');
		assert.equal(event.args.a, args[0]);
		assert.equal(event.args.b, args[1]);
		assert.equal(event.args.c, args[2]);
	});

	it('can transact from arbitrary account', async function() {
		const c = new FlexContract(ABI, {provider: provider, bytecode: BYTECODE});
		await (await c.new()).receipt;
		await (await c.transact({key: accounts[0].secretKey})).receipt;
	});
});
