// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Test} from "forge-std/Test.sol";
import {HotColdGame} from "../src/HotColdGame.sol";

contract HotColdGameTest is Test {
    HotColdGame public game;
    address public owner = address(this);
    address public player1 = address(0x1);
    address public player2 = address(0x2);
    address public winner = address(0x3);

    event RoundStarted(uint256 indexed roundId, uint256 buyIn);
    event BuyInUpdated(uint256 indexed roundId, uint256 newBuyIn);
    event GuessPaid(
        uint256 indexed roundId,
        address indexed player,
        uint256 amount,
        uint256 potAfter,
        uint256 guessCount
    );
    event WinnerPaid(uint256 indexed roundId, address indexed winner, uint256 payout);

    function setUp() public {
        game = new HotColdGame(0.01 ether);
    }

    function testConstructorInitializesRound() public {
        (uint256 buyIn, uint256 pot, uint256 guesses, address roundWinner, bool active) = game.rounds(1);
        assertEq(buyIn, 0.01 ether);
        assertEq(pot, 0);
        assertEq(guesses, 0);
        assertEq(roundWinner, address(0));
        assertTrue(active);
        assertEq(game.currentRoundId(), 1);
        assertEq(game.owner(), owner);
    }

    function testPayForGuessAccumulatesPot() public {
        vm.deal(player1, 1 ether);

        vm.prank(player1);
        vm.expectEmit(true, true, false, true);
        emit GuessPaid(1, player1, 0.01 ether, 0.01 ether, 1);
        game.payForGuess{value: 0.01 ether}(1);

        (, uint256 pot, uint256 guesses,,) = game.rounds(1);
        assertEq(pot, 0.01 ether);
        assertEq(guesses, 1);
    }

    function testPayForGuessRequiresExactBuyIn() public {
        vm.deal(player1, 1 ether);

        vm.prank(player1);
        vm.expectRevert(bytes("Incorrect buy-in"));
        game.payForGuess{value: 0.005 ether}(1);
    }

    function testPayForGuessOnlyActiveRound() public {
        vm.deal(player1, 1 ether);

        game.closeActiveRound();

        vm.prank(player1);
        vm.expectRevert(bytes("Round not active"));
        game.payForGuess{value: 0.01 ether}(1);
    }

    function testUpdateBuyInOnlyOwner() public {
        vm.prank(player1);
        vm.expectRevert("Ownable: caller is not the owner");
        game.updateBuyIn(0.02 ether);
    }

    function testUpdateBuyInChangesPriceAndEmits() public {
        vm.expectEmit(true, false, false, true);
        emit BuyInUpdated(1, 0.02 ether);
        game.updateBuyIn(0.02 ether);

        (uint256 buyIn,,,,) = game.rounds(1);
        assertEq(buyIn, 0.02 ether);
    }

    function testSettleWinnerPaysOutPot() public {
        vm.deal(player1, 1 ether);
        vm.deal(player2, 1 ether);

        vm.prank(player1);
        game.payForGuess{value: 0.01 ether}(1);
        vm.prank(player2);
        game.payForGuess{value: 0.01 ether}(1);

        uint256 balanceBefore = winner.balance;

        vm.expectEmit(true, true, false, true);
        emit WinnerPaid(1, winner, 0.02 ether);
        game.settleWinner(payable(winner));

        (, uint256 pot, , address roundWinner, bool active) = game.rounds(1);
        assertEq(pot, 0);
        assertEq(roundWinner, winner);
        assertFalse(active);
        assertEq(winner.balance, balanceBefore + 0.02 ether);
    }

    function testCannotSettleWithZeroAddress() public {
        vm.expectRevert(bytes("Winner required"));
        game.settleWinner(payable(address(0)));
    }

    function testCannotPayAfterSettlement() public {
        vm.deal(player1, 1 ether);
        vm.prank(player1);
        game.payForGuess{value: 0.01 ether}(1);

        game.settleWinner(payable(winner));

        vm.prank(player1);
        vm.expectRevert(bytes("Round not active"));
        game.payForGuess{value: 0.01 ether}(1);
    }

    function testStartNextRoundRequiresInactive() public {
        vm.expectRevert(bytes("Current round still active"));
        game.startNextRound(0.01 ether);
    }

    function testStartNextRoundAfterSettlement() public {
        game.closeActiveRound();
        uint256 newId = game.startNextRound(0.05 ether);

        assertEq(newId, 2);
        assertEq(game.currentRoundId(), 2);

        (uint256 buyIn, uint256 pot, uint256 guesses, address roundWinner, bool active) = game.rounds(2);
        assertEq(buyIn, 0.05 ether);
        assertEq(pot, 0);
        assertEq(guesses, 0);
        assertEq(roundWinner, address(0));
        assertTrue(active);
    }

    function testWithdrawIdleTracksPot() public {
        vm.deal(player1, 1 ether);
        vm.prank(player1);
        game.payForGuess{value: 0.01 ether}(1);

        game.closeActiveRound();

        vm.expectRevert(bytes("Insufficient idle balance"));
        game.withdrawIdle(payable(owner), 0.02 ether);

        uint256 ownerBalanceBefore = owner.balance;
        game.withdrawIdle(payable(owner), 0.01 ether);

        (, uint256 pot,,,) = game.rounds(1);
        assertEq(pot, 0);
        assertEq(owner.balance, ownerBalanceBefore + 0.01 ether);
    }
}
