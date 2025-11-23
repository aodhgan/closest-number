// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "solady/src/tokens/ERC20.sol";
import {HotColdGame} from "../src/HotColdGame.sol";

contract MockPermitToken is ERC20 {
    string internal _name = "MockPermit";
    string internal _symbol = "MCK";

    function name() public view override returns (string memory) {
        return _name;
    }

    function symbol() public view override returns (string memory) {
        return _symbol;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract HotColdGameTest is Test {
    HotColdGame public game;
    MockPermitToken public token;

    uint256 public ownerKey = 0xAAA1;
    uint256 public teeKey = 0xAAA2;
    uint256 public player1Key = 0xAAA3;
    uint256 public player2Key = 0xAAA4;

    address public owner = vm.addr(ownerKey);
    address public tee = vm.addr(teeKey);
    address public player1 = vm.addr(player1Key);
    address public player2 = vm.addr(player2Key);
    address public winner = address(0x99);

    event RoundStarted(uint256 indexed roundId, uint256 buyIn, bytes32 targetCommitment);
    event BuyInUpdated(uint256 indexed roundId, uint256 newBuyIn);
    event GuessPaid(
        uint256 indexed roundId,
        address indexed player,
        uint256 amount,
        uint256 potAfter,
        uint256 guessCount
    );
    event WinnerPaid(uint256 indexed roundId, address indexed winner, uint256 payout);

    bytes32 public initialCommitment = keccak256("round1");
    
    function setUp() public {
        token = new MockPermitToken();
        game = new HotColdGame(tee, address(token));

        token.mint(player1, 10 ether);
        token.mint(player2, 10 ether);
        token.mint(address(game), 0); // satisfy lint

        vm.prank(tee);
        game.startNextRound(1 ether, initialCommitment);

        vm.prank(tee);
        game.transferOwnership(owner);
    }

    function testConstructorSetsAddresses() public {
        assertEq(game.currentRoundId(), 1);
        assertEq(game.owner(), owner);
        assertEq(game.tee(), tee);
        assertEq(address(game.paymentToken()), address(token));
    }

    function testPayForGuessAccumulatesPot() public {
        uint256 deadline = block.timestamp + 1 days;
        (uint8 v, bytes32 r, bytes32 s) = signPermit(player1Key, player1, address(game), 1 ether, deadline);

        vm.expectEmit(true, true, false, true);
        emit GuessPaid(1, player1, 1 ether, 1 ether, 1);
        game.payForGuess(1, player1, 1 ether, deadline, v, r, s);

        (, uint256 pot, uint256 guesses,,) = game.rounds(1);
        assertEq(pot, 1 ether);
        assertEq(guesses, 1);
        assertEq(token.balanceOf(address(game)), 1 ether);
    }

    function testPayForGuessRequiresActiveRound() public {
        vm.prank(tee);
        game.closeActiveRound();

        uint256 deadline = block.timestamp + 1 days;
        (uint8 v, bytes32 r, bytes32 s) = signPermit(player1Key, player1, address(game), 1 ether, deadline);

        vm.expectRevert(bytes("Round not active"));
        game.payForGuess(1, player1, 1 ether, deadline, v, r, s);
    }

    function testUpdateBuyInOnlyTee() public {
        vm.prank(player1);
        vm.expectRevert(bytes("Caller is not tee"));
        game.updateBuyIn(2 ether);
    }

    function testUpdateBuyInChangesPriceAndEmits() public {
        vm.prank(tee);
        vm.expectEmit(true, false, false, true);
        emit BuyInUpdated(1, 2 ether);
        game.updateBuyIn(2 ether);

        (uint256 buyIn,,,,) = game.rounds(1);
        assertEq(buyIn, 2 ether);
    }

    function testOwnerCanRotateTee() public {
        address newTee = address(0xabc);
        vm.prank(owner);
        game.updateTee(newTee);
        assertEq(game.tee(), newTee);

        vm.prank(newTee);
        game.updateBuyIn(2 ether);
        (uint256 buyIn,,,,) = game.rounds(1);
        assertEq(buyIn, 2 ether);
    }

    function testSettleWinnerPaysOutPot() public {
        uint256 deadline = block.timestamp + 1 days;

        (uint8 v1, bytes32 r1, bytes32 s1) = signPermit(player1Key, player1, address(game), 1 ether, deadline);
        (uint8 v2, bytes32 r2, bytes32 s2) = signPermit(player2Key, player2, address(game), 1 ether, deadline);

        game.payForGuess(1, player1, 1 ether, deadline, v1, r1, s1);
        game.payForGuess(1, player2, 1 ether, deadline, v2, r2, s2);

        uint256 balanceBefore = token.balanceOf(winner);

        vm.expectEmit(true, true, false, true);
        emit WinnerPaid(1, winner, 2 ether);
        vm.prank(tee);
        game.settleWinner(payable(winner));

        (, uint256 pot, , address roundWinner, bool active) = game.rounds(1);
        assertEq(pot, 0);
        assertEq(roundWinner, winner);
        assertFalse(active);
        assertEq(token.balanceOf(winner), balanceBefore + 2 ether);
    }

    function testCannotSettleWithZeroAddress() public {
        vm.expectRevert(bytes("Winner required"));
        vm.prank(tee);
        game.settleWinner(payable(address(0)));
    }

    function testCannotPayAfterSettlement() public {
        uint256 deadline = block.timestamp + 1 days;
        (uint8 v1, bytes32 r1, bytes32 s1) = signPermit(player1Key, player1, address(game), 1 ether, deadline);
        game.payForGuess(1, player1, 1 ether, deadline, v1, r1, s1);

        vm.prank(tee);
        game.settleWinner(payable(winner));

        (uint8 v2, bytes32 r2, bytes32 s2) = signPermit(player1Key, player1, address(game), 1 ether, deadline);

        vm.expectRevert(bytes("Round not active"));
        game.payForGuess(1, player1, 1 ether, deadline, v2, r2, s2);
    }

    function testStartNextRoundRequiresInactive() public {
        vm.expectRevert(bytes("Current round still active"));
        vm.prank(tee);
        game.startNextRound(1 ether, keccak256("round2"));
    }

    function testStartNextRoundRequiresCommitment() public {
        vm.prank(tee);
        game.closeActiveRound();

        vm.expectRevert(bytes("Target commitment required"));
        vm.prank(tee);
        game.startNextRound(1 ether, bytes32(0));
    }

    function testStartNextRoundAfterClosure() public {
        vm.prank(tee);
        game.closeActiveRound();

        bytes32 nextCommitment = keccak256("round2");
        vm.prank(tee);
        uint256 newId = game.startNextRound(2 ether, nextCommitment);

        assertEq(newId, 2);
        assertEq(game.currentRoundId(), 2);

        (uint256 buyIn, uint256 pot, uint256 guesses, address roundWinner, bool active, bytes32 commitment) = game.rounds(2);
        assertEq(buyIn, 2 ether);
        assertEq(pot, 0);
        assertEq(guesses, 0);
        assertEq(roundWinner, address(0));
        assertTrue(active);
        assertEq(commitment, nextCommitment);
    }

    function testSettleAndStartNextRound() public {
        uint256 deadline = block.timestamp + 1 days;

        (uint8 v1, bytes32 r1, bytes32 s1) = signPermit(player1Key, player1, address(game), 1 ether, deadline);
        (uint8 v2, bytes32 r2, bytes32 s2) = signPermit(player2Key, player2, address(game), 1 ether, deadline);

        game.payForGuess(1, player1, 1 ether, deadline, v1, r1, s1);
        game.payForGuess(1, player2, 1 ether, deadline, v2, r2, s2);

        bytes32 nextCommitment = keccak256("round2");

        vm.expectEmit(true, true, false, true);
        emit WinnerPaid(1, winner, 2 ether);
        vm.expectEmit(true, false, false, true);
        emit RoundStarted(2, 1 ether, nextCommitment);
        vm.prank(tee);
        uint256 newId = game.settleAndStartNextRound(payable(winner), 1 ether, nextCommitment);

        assertEq(newId, 2);
        (, uint256 pot, , address roundWinner, bool active) = game.rounds(1);
        assertEq(pot, 0);
        assertEq(roundWinner, winner);
        assertFalse(active);

        (uint256 buyIn,, uint256 guesses, address newWinner, bool roundActive, bytes32 commitment) = game.rounds(2);
        assertEq(buyIn, 1 ether);
        assertEq(guesses, 0);
        assertEq(newWinner, address(0));
        assertTrue(roundActive);
        assertEq(commitment, nextCommitment);
        assertEq(game.currentRoundId(), 2);
    }

    function testWithdrawIdleTracksPot() public {
        uint256 deadline = block.timestamp + 1 days;
        (uint8 v, bytes32 r, bytes32 s) = signPermit(player1Key, player1, address(game), 1 ether, deadline);
        game.payForGuess(1, player1, 1 ether, deadline, v, r, s);

        vm.prank(tee);
        game.closeActiveRound();

        vm.expectRevert(bytes("Insufficient idle balance"));
        vm.prank(tee);
        game.withdrawIdle(payable(owner), 2 ether);

        uint256 ownerBalanceBefore = token.balanceOf(owner);
        vm.prank(tee);
        game.withdrawIdle(payable(owner), 1 ether);

        (, uint256 pot,,,) = game.rounds(1);
        assertEq(pot, 0);
        assertEq(token.balanceOf(owner), ownerBalanceBefore + 1 ether);
    }

    function signPermit(
        uint256 signerKey,
        address owner,
        address spender,
        uint256 value,
        uint256 deadline
    ) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        bytes32 digest = token.permitDigest(owner, spender, value, token.nonces(owner), deadline);
        return vm.sign(signerKey, digest);
    }
}
