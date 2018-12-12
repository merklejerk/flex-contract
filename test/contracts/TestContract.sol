pragma solidity ^0.5;

contract TestContract {

	event SingleEvent(address indexed a, uint256 b, bytes32 c);
	event RepeatedEvent(uint256 idx, address indexed a, uint256 b, bytes32 c);

	constructor() public {}

	function constFn() public pure returns (uint256) {
		return 1;
	}

	function constFn(uint256 a) public pure returns (uint256) {
		return a * 2;
	}

	function constFn(uint256 a, uint256 b) public pure returns (uint256) {
		return (a + b) * 3;
	}

	function echoAddress(address a) public pure returns (address) {
		return a;
	}

	function echoArray(bytes32[] memory a)
			public pure returns (bytes32[] memory) {

		return a;
	}

	function echoFixedArray(bytes32[3] memory a)
			public pure returns (bytes32[3] memory) {

		return a;
	}

	function returnMultiple(address a, uint256 b, bytes32 c)
			public pure returns (address, uint256, bytes32) {
		return (a, b, c);
	}

	function returnMultipleNamed(address a, uint256 b, bytes32 c)
			public pure returns (address r0, uint256 r1, bytes32 r2) {
		return (a, b, c);
	}

	function transact() public payable returns (bool) {
		return true;
	}

	function raiseEvent(address a, uint256 b, bytes32 c)
			public payable returns (bool) {

		emit SingleEvent(a, b, c);
		return true;
	}

	function raiseEvents(uint256 count, address a, uint256 b, bytes32 c)
			public payable returns (bool) {

		for (uint256 i = 0; i < count; i++)
			emit RepeatedEvent(i, a, b, c);
		return true;
	}

	function callOther(address other, address a, uint256 b, bytes32 c)
			public payable returns (bool) {

		return TestContract(other).raiseEvent(a, b, c);
	}
}
