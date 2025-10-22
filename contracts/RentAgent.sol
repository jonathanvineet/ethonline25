// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract RentAgent {
    address public owner;

    event AgentUploaded(string cid, address indexed uploader, uint256 price);
    event AgentRented(string cid, address indexed renter, uint256 price);

    struct Agent {
        string cid;
        address uploader;
        uint256 price;
    }

    mapping(string => Agent) public agents;
    // rentals[cid][renter] = expiryTimestamp
    mapping(string => mapping(address => uint256)) public rentals;

    constructor() {
        owner = msg.sender;
    }

    function uploadAgent(string calldata cid, uint256 price) external {
        require(bytes(cid).length > 0, "cid required");
        agents[cid] = Agent({ cid: cid, uploader: msg.sender, price: price });
        emit AgentUploaded(cid, msg.sender, price);
    }

    function rentAgent(string calldata cid) external payable {
        Agent memory a = agents[cid];
        require(bytes(a.cid).length > 0, "agent not found");
        require(msg.value >= a.price, "insufficient payment");
        // record rental BEFORE forwarding funds (checks-effects-interactions)
        uint256 rentalDuration = 3600; // 1 hour in seconds
        rentals[cid][msg.sender] = block.timestamp + rentalDuration;

        // forward payment to uploader
        (bool sent, ) = payable(a.uploader).call{value: msg.value}('');
        require(sent, "failed to forward payment");

        emit AgentRented(cid, msg.sender, msg.value);
    }

    function isRenter(string calldata cid, address user) external view returns (bool) {
        return rentals[cid][user] > block.timestamp;
    }
}
