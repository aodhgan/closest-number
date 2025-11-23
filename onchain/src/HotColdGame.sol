// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";

interface IPermitERC20 is IERC20, IERC20Permit {}

/// @title HotColdGame
/// @notice Minimal on-chain vault for the hot–cold enclave game. Players prepay the current buy-in
/// before submitting their off-chain guess, while the coordinator (TEE or owner) can adjust pricing
/// and settle the winning payout.
contract HotColdGame is Ownable, ReentrancyGuard {
    /// @dev Emitted when a new round is initialized.
    event RoundStarted(uint256 indexed roundId, uint256 buyIn, bytes32 targetCommitment);

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
        uint256 buyIn; // price per guess in token base units
        uint256 pot; // accumulated ERC20 tokens for this round
        uint256 guesses; // number of paid guesses
        address winner; // non-zero when settled
        bool active; // true while accepting payments
        bytes32 targetCommitment; // hash commitment to the hidden target
    }

    uint256 public currentRoundId;
    mapping(uint256 => Round) public rounds;

    /// @notice ERC20 token used for payments (must implement ERC2612 permit)
    IPermitERC20 public immutable paymentToken;

    /// @notice The only address allowed to update pricing and settle rounds.
    address public tee;

    modifier onlyTee() {
        require(msg.sender == tee, "Caller is not tee");
        _;
    }

    /// @param initialBuyInWei starting buy-in for the first round
    /// @param teeAddress trusted enclave/TEE controller
    constructor(
        uint256 initialBuyInWei,
        address teeAddress,
        address paymentTokenAddress,
        bytes32 initialTargetCommitment
    ) {
        require(initialBuyInWei > 0, "Buy-in must be > 0");
        require(teeAddress != address(0), "TEE address required");
        require(paymentTokenAddress != address(0), "Payment token required");
        require(initialTargetCommitment != bytes32(0), "Target commitment required");

        tee = teeAddress;
        paymentToken = IPermitERC20(paymentTokenAddress);

        currentRoundId = 1;
        rounds[1] = Round({
            buyIn: initialBuyInWei,
            pot: 0,
            guesses: 0,
            winner: address(0),
            active: true,
            targetCommitment: initialTargetCommitment
        });

        emit RoundStarted(1, initialBuyInWei, initialTargetCommitment);
        emit TeeUpdated(address(0), teeAddress);
    }

    /// @notice Pull a buy-in payment from the payer using an ERC2612 permit and credit the round pot.
    /// @dev This method pays gas on behalf of the user; the backend/TEE submits the transaction with the
    /// signed permit payload provided by the player.
    /// @param roundId round identifier that must match the current active round
    /// @param payer address of the player who signed the authorization
    /// @param value amount approved in the permit signature (must equal the current buy-in)
    /// @param deadline signature expiry timestamp
    /// @param v secp256k1 recovery id
    /// @param r secp256k1 signature r
    /// @param s secp256k1 signature s
    function payForGuess(
        uint256 roundId,
        address payer,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant {
        require(roundId == currentRoundId, "Only current round");

        Round storage round = rounds[roundId];
        require(round.active, "Round not active");

        require(value == round.buyIn, "Permit value mismatch");

        paymentToken.permit(payer, address(this), value, deadline, v, r, s);

        require(paymentToken.transferFrom(payer, address(this), round.buyIn), "Payment transfer failed");

        round.pot += round.buyIn;
        round.guesses += 1;

        emit GuessPaid(roundId, payer, round.buyIn, round.pot, round.guesses);
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

        require(paymentToken.transfer(winner, payout), "Payout failed");

        emit WinnerPaid(currentRoundId, winner, payout);
    }

    /// @notice Start a fresh round after the previous round has been settled or manually closed.
    /// @param buyInWei price per guess in wei for the new round
    /// @param targetCommitment hash commitment to the hidden target for the new round
    /// @return newRoundId the identifier for the newly started round
    function startNextRound(uint256 buyInWei, bytes32 targetCommitment) external onlyTee returns (uint256 newRoundId) {
        require(buyInWei > 0, "Buy-in must be > 0");
        require(targetCommitment != bytes32(0), "Target commitment required");
        require(!rounds[currentRoundId].active, "Current round still active");

        newRoundId = currentRoundId + 1;
        currentRoundId = newRoundId;
        rounds[newRoundId] = Round({
            buyIn: buyInWei,
            pot: 0,
            guesses: 0,
            winner: address(0),
            active: true,
            targetCommitment: targetCommitment
        });

        emit RoundStarted(newRoundId, buyInWei, targetCommitment);
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

        require(paymentToken.transfer(to, amount), "Withdraw failed");
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
