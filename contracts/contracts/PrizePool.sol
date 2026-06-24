// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract PrizePool {
    address public owner;

    struct MatchPool {
        address[] players;
        uint256 requiredStake;
        uint256 totalStake;
        bool paid;
        bool refunded;
        bytes32 storageHash;
        address winner;
        bytes32 rulesHash;
    }

    mapping(bytes32 => MatchPool) public matches;
    mapping(bytes32 => mapping(address => uint256)) public fundedAmount;

    event MatchCreated(bytes32 indexed matchId, address[] players, uint256 requiredStake, bytes32 rulesHash);
    event Funded(bytes32 indexed matchId, address indexed funder, uint256 amount);
    event Paid(bytes32 indexed matchId, address indexed winner, uint256 amount, bytes32 storageHash);
    event MatchRefunded(bytes32 indexed matchId, bytes32 indexed storageHash);
    event PlayerRefunded(bytes32 indexed matchId, address indexed player, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function createMatch(
        bytes32 matchId,
        address[] calldata players,
        uint256 requiredStake,
        bytes32 rulesHash
    ) external onlyOwner {
        require(matches[matchId].players.length == 0, "exists");
        require(players.length >= 2, "need players");
        require(requiredStake > 0, "zero stake");
        require(rulesHash != bytes32(0), "zero rules hash");
        matches[matchId].players = players;
        matches[matchId].requiredStake = requiredStake;
        matches[matchId].rulesHash = rulesHash;
        emit MatchCreated(matchId, players, requiredStake, rulesHash);
    }

    function fund(bytes32 matchId) external payable {
        MatchPool storage pool = matches[matchId];
        require(pool.players.length > 0, "missing match");
        require(!pool.paid && !pool.refunded, "already finalized");
        require(isPlayer(matchId, msg.sender), "not player");
        require(msg.value == pool.requiredStake, "wrong stake");
        require(fundedAmount[matchId][msg.sender] == 0, "already funded");
        fundedAmount[matchId][msg.sender] = msg.value;
        pool.totalStake += msg.value;
        emit Funded(matchId, msg.sender, msg.value);
    }

    function payout(bytes32 matchId, address payable winner, bytes32 storageHash) external onlyOwner {
        MatchPool storage pool = matches[matchId];
        require(pool.players.length > 0, "missing match");
        require(!pool.paid && !pool.refunded, "already finalized");
        require(isPlayer(matchId, winner), "winner not player");
        require(isFullyFunded(matchId), "not fully funded");
        require(storageHash != bytes32(0), "zero storage hash");
        uint256 amount = pool.totalStake;
        require(amount > 0, "empty pool");
        pool.paid = true;
        pool.winner = winner;
        pool.storageHash = storageHash;
        (bool ok, ) = winner.call{value: amount}("");
        require(ok, "transfer failed");
        emit Paid(matchId, winner, amount, storageHash);
    }

    function refundDraw(bytes32 matchId, bytes32 storageHash) external onlyOwner {
        MatchPool storage pool = matches[matchId];
        require(pool.players.length > 0, "missing match");
        require(!pool.paid && !pool.refunded, "already finalized");
        require(isFullyFunded(matchId), "not fully funded");
        require(storageHash != bytes32(0), "zero storage hash");

        pool.refunded = true;
        pool.storageHash = storageHash;

        for (uint256 i = 0; i < pool.players.length; i++) {
            address payable player = payable(pool.players[i]);
            uint256 amount = fundedAmount[matchId][player];
            require(amount > 0, "missing funded amount");
            fundedAmount[matchId][player] = 0;
            pool.totalStake -= amount;
            (bool ok, ) = player.call{value: amount}("");
            require(ok, "transfer failed");
            emit PlayerRefunded(matchId, player, amount);
        }

        emit MatchRefunded(matchId, storageHash);
    }

    function isFullyFunded(bytes32 matchId) public view returns (bool) {
        MatchPool storage pool = matches[matchId];
        if (pool.players.length == 0) {
            return false;
        }
        for (uint256 i = 0; i < pool.players.length; i++) {
            if (fundedAmount[matchId][pool.players[i]] != pool.requiredStake) {
                return false;
            }
        }
        return pool.totalStake == pool.requiredStake * pool.players.length;
    }

    function isPlayer(bytes32 matchId, address player) public view returns (bool) {
        MatchPool storage pool = matches[matchId];
        for (uint256 i = 0; i < pool.players.length; i++) {
            if (pool.players[i] == player) {
                return true;
            }
        }
        return false;
    }
}
