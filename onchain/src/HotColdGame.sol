// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/// @title HotColdGame
/// @notice Minimal on-chain vault for the hot–cold enclave game. Players prepay the current buy-in
/// before submitting their off-chain guess, while the coordinator (TEE or owner) can adjust pricing
/// and settle the winning payout.
contract HotColdGame is Ownable, ReentrancyGuard {
    /// @dev Emitted when a new round is initialized.
    event RoundStarted(uint256 indexed roundId, uint256 buyIn);

    /// @dev Emitted when the buy-in changes for the active round.
    event BuyInUpdated(uint256 indexed roundId, uint256 newBuyIn);

    /// @dev Emitted when a player prepays for a guess.
    event GuessPaid(
        uint256 indexed roundId,
        address indexed player,
        uint256 amount,
        uint256 potAfter,
        uint256 guessCount
    );

    /// @dev Emitted when the coordinator settles the winner.
    event WinnerPaid(uint256 indexed roundId, address indexed winner, uint256 payout);

    /// @dev Emitted when the trusted enclave/TEE address changes.
    event TeeUpdated(address indexed previousTee, address indexed newTee);

    struct Round {
        uint256 buyIn; // price per guess in wei
        uint256 pot; // accumulated ETH for this round
        uint256 guesses; // number of paid guesses
        address winner; // non-zero when settled
        bool active; // true while accepting payments
    }

    uint256 public currentRoundId;
    mapping(uint256 => Round) public rounds;

    /// @notice The only address allowed to update pricing and settle rounds.
    address public tee;

    modifier onlyTee() {
        require(msg.sender == tee, "Caller is not tee");
        _;
    }

    /// @param initialBuyInWei starting buy-in for the first round
    /// @param teeAddress trusted enclave/TEE controller
    constructor(uint256 initialBuyInWei, address teeAddress) {
        require(initialBuyInWei > 0, "Buy-in must be > 0");
        require(teeAddress != address(0), "TEE address required");

        tee = teeAddress;

        currentRoundId = 1;
        rounds[1] = Round({buyIn: initialBuyInWei, pot: 0, guesses: 0, winner: address(0), active: true});

        emit RoundStarted(1, initialBuyInWei);
        emit TeeUpdated(address(0), teeAddress);
    }

    /// @notice Prepay for a guess in the active round. The enclave/backend should only accept guesses
    /// after observing this event.
    /// @param roundId round identifier that must match the current active round
    function payForGuess(uint256 roundId) external payable nonReentrant {
        require(roundId == currentRoundId, "Only current round");

        Round storage round = rounds[roundId];
        require(round.active, "Round not active");
        require(msg.value == round.buyIn, "Incorrect buy-in");

        round.pot += msg.value;
        round.guesses += 1;

        emit GuessPaid(roundId, msg.sender, msg.value, round.pot, round.guesses);
    }

    /// @notice Adjust the buy-in for the active round. Intended for TEE-driven pricing bumps when
    /// guesses get close.
    /// @param newBuyInWei new price per guess in wei
    function updateBuyIn(uint256 newBuyInWei) external onlyTee {
        require(newBuyInWei > 0, "Buy-in must be > 0");

        Round storage round = rounds[currentRoundId];
        require(round.active, "Round not active");

        round.buyIn = newBuyInWei;
        emit BuyInUpdated(currentRoundId, newBuyInWei);
    }

    /// @notice Settle the current round and pay the winner the entire pot. The next round can be
    /// opened after this completes.
    /// @param winner address that produced the exact match
    function settleWinner(address payable winner) external onlyTee nonReentrant {
        Round storage round = rounds[currentRoundId];
        require(round.active, "Round not active");
        require(winner != address(0), "Winner required");

        uint256 payout = round.pot;
        round.pot = 0;
        round.active = false;
        round.winner = winner;

        (bool success, ) = winner.call{value: payout}("");
        require(success, "Payout failed");

        emit WinnerPaid(currentRoundId, winner, payout);
    }

    /// @notice Start a fresh round after the previous round has been settled or manually closed.
    /// @param buyInWei price per guess in wei for the new round
    /// @return newRoundId the identifier for the newly started round
    function startNextRound(uint256 buyInWei) external onlyTee returns (uint256 newRoundId) {
        require(buyInWei > 0, "Buy-in must be > 0");
        require(!rounds[currentRoundId].active, "Current round still active");

        newRoundId = currentRoundId + 1;
        currentRoundId = newRoundId;
        rounds[newRoundId] = Round({buyIn: buyInWei, pot: 0, guesses: 0, winner: address(0), active: true});

        emit RoundStarted(newRoundId, buyInWei);
    }

    /// @notice Emergency close for the active round without paying out, keeping funds in contract
    /// until the coordinator decides how to handle them.
    function closeActiveRound() external onlyTee {
        Round storage round = rounds[currentRoundId];
        require(round.active, "Round not active");
        round.active = false;
    }

    /// @notice Withdraw idle funds that are not tied to an active pot (e.g., after manual closure).
    /// @dev Ensures we never siphon funds from an active round and keeps accounting accurate.
    /// @param to recipient address
    /// @param amount amount to withdraw in wei
    function withdrawIdle(address payable to, uint256 amount) external onlyTee nonReentrant {
        require(to != address(0), "Invalid recipient");
        require(amount > 0, "Amount must be > 0");

        Round storage round = rounds[currentRoundId];
        require(!round.active, "Round still active");
        require(amount <= round.pot, "Insufficient idle balance");

        round.pot -= amount;

        (bool success, ) = to.call{value: amount}("");
        require(success, "Withdraw failed");
    }

    /// @notice Rotate the trusted enclave authority.
    /// @param newTee address of the new enclave signer
    function updateTee(address newTee) external onlyOwner {
        require(newTee != address(0), "TEE address required");
        address previous = tee;
        tee = newTee;
        emit TeeUpdated(previous, newTee);
    }
}
