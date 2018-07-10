pragma solidity^0.4.24;

contract TestContract {

	event SingleEvent(address indexed a, uint256 b, bytes32 c);
	event RepeatedEvent(uint256 idx, address indexed a, uint256 b, bytes32 c);

	constructor() public {}

	function constFn() public view returns (uint256) {
		return 1;
	}

	function constFn(uint256 a) public view returns (uint256) {
		return 2;
	}

	function constFn(uint256 a, uint256 b) public view returns (uint256) {
		return 3;
	}

	function echoAddress(address a) public view returns (address) {
		return a;
	}

	function transact() public payable returns (bool) {
		return true;
	}

	function raiseEvent(address a, uint256 b, bytes32 c)
			public payable returns (bool) {

		SingleEvent(a, b, c);
		return true;
	}

	function raiseEvents(uint256 count, address a, uint256 b, bytes32 c)
			public payable returns (bool) {

		for (uint256 i = 0; i < count; i++)
			RepeatedEvent(i, a, b, c);
		return true;
	}

	function callOther(address other, address a, uint256 b, bytes32 c)
			public payable returns (bool) {

		return TestContract(other).raiseEvent(a, b, c);
	}
}
