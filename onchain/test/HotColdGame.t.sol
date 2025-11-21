// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Test} from "forge-std/Test.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {HotColdGame} from "../src/HotColdGame.sol";

contract MockERC3009 is ERC20, EIP712 {
    using ECDSA for bytes32;

    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    mapping(address => mapping(bytes32 => bool)) public authorizationState;

    constructor() ERC20("Mock3009", "MCK") EIP712("Mock3009", "1") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function authorizationDigest(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce
    ) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(TRANSFER_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce)
        );
        return _hashTypedDataV4(structHash);
    }

    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external returns (bool) {
        require(block.timestamp > validAfter, "Authorization not yet valid");
        require(block.timestamp < validBefore, "Authorization expired");
        require(!authorizationState[from][nonce], "Authorization already used");

        bytes32 digest = authorizationDigest(from, to, value, validAfter, validBefore, nonce);
        address signer = ECDSA.recover(digest, v, r, s);
        require(signer == from, "Invalid signature");

        authorizationState[from][nonce] = true;
        _transfer(from, to, value);
        return true;
    }
}

contract HotColdGameTest is Test {
    HotColdGame public game;
    MockERC3009 public token;

    uint256 public ownerKey = 0xAAA1;
    uint256 public teeKey = 0xAAA2;
    uint256 public player1Key = 0xAAA3;
    uint256 public player2Key = 0xAAA4;

    address public owner = vm.addr(ownerKey);
    address public tee = vm.addr(teeKey);
    address public player1 = vm.addr(player1Key);
    address public player2 = vm.addr(player2Key);
    address public winner = address(0x99);

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
        token = new MockERC3009();
        game = new HotColdGame(1 ether, tee, address(token));

        token.mint(player1, 10 ether);
        token.mint(player2, 10 ether);
        token.mint(address(game), 0); // satisfy lint

        vm.prank(tee);
        game.transferOwnership(owner);
    }

    function testConstructorInitializesRound() public {
        (uint256 buyIn, uint256 pot, uint256 guesses, address roundWinner, bool active) = game.rounds(1);
        assertEq(buyIn, 1 ether);
        assertEq(pot, 0);
        assertEq(guesses, 0);
        assertEq(roundWinner, address(0));
        assertTrue(active);
        assertEq(game.currentRoundId(), 1);
        assertEq(game.owner(), owner);
        assertEq(game.tee(), tee);
        assertEq(address(game.paymentToken()), address(token));
    }

    function testPayForGuessAccumulatesPot() public {
        bytes32 nonce = keccak256("guess1");
        (uint8 v, bytes32 r, bytes32 s) = signAuth(player1Key, player1, address(game), 1 ether, nonce);

        vm.expectEmit(true, true, false, true);
        emit GuessPaid(1, player1, 1 ether, 1 ether, 1);
        game.payForGuess(1, player1, block.timestamp, block.timestamp + 1 days, nonce, v, r, s);

        (, uint256 pot, uint256 guesses,,) = game.rounds(1);
        assertEq(pot, 1 ether);
        assertEq(guesses, 1);
        assertEq(token.balanceOf(address(game)), 1 ether);
    }

    function testPayForGuessRequiresActiveRound() public {
        vm.prank(tee);
        game.closeActiveRound();

        bytes32 nonce = keccak256("guess2");
        (uint8 v, bytes32 r, bytes32 s) = signAuth(player1Key, player1, address(game), 1 ether, nonce);

        vm.expectRevert(bytes("Round not active"));
        game.payForGuess(1, player1, block.timestamp, block.timestamp + 1 days, nonce, v, r, s);
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
        bytes32 nonce1 = keccak256("p1");
        bytes32 nonce2 = keccak256("p2");

        (uint8 v1, bytes32 r1, bytes32 s1) = signAuth(player1Key, player1, address(game), 1 ether, nonce1);
        (uint8 v2, bytes32 r2, bytes32 s2) = signAuth(player2Key, player2, address(game), 1 ether, nonce2);

        game.payForGuess(1, player1, block.timestamp, block.timestamp + 1 days, nonce1, v1, r1, s1);
        game.payForGuess(1, player2, block.timestamp, block.timestamp + 1 days, nonce2, v2, r2, s2);

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
        bytes32 nonce1 = keccak256("p1");
        (uint8 v1, bytes32 r1, bytes32 s1) = signAuth(player1Key, player1, address(game), 1 ether, nonce1);
        game.payForGuess(1, player1, block.timestamp, block.timestamp + 1 days, nonce1, v1, r1, s1);

        vm.prank(tee);
        game.settleWinner(payable(winner));

        bytes32 nonce2 = keccak256("p2");
        (uint8 v2, bytes32 r2, bytes32 s2) = signAuth(player1Key, player1, address(game), 1 ether, nonce2);

        vm.expectRevert(bytes("Round not active"));
        game.payForGuess(1, player1, block.timestamp, block.timestamp + 1 days, nonce2, v2, r2, s2);
    }

    function testStartNextRoundRequiresInactive() public {
        vm.expectRevert(bytes("Current round still active"));
        vm.prank(tee);
        game.startNextRound(1 ether);
    }

    function testStartNextRoundAfterClosure() public {
        vm.prank(tee);
        game.closeActiveRound();

        vm.prank(tee);
        uint256 newId = game.startNextRound(2 ether);

        assertEq(newId, 2);
        assertEq(game.currentRoundId(), 2);

        (uint256 buyIn, uint256 pot, uint256 guesses, address roundWinner, bool active) = game.rounds(2);
        assertEq(buyIn, 2 ether);
        assertEq(pot, 0);
        assertEq(guesses, 0);
        assertEq(roundWinner, address(0));
        assertTrue(active);
    }

    function testWithdrawIdleTracksPot() public {
        bytes32 nonce = keccak256("idle");
        (uint8 v, bytes32 r, bytes32 s) = signAuth(player1Key, player1, address(game), 1 ether, nonce);
        game.payForGuess(1, player1, block.timestamp, block.timestamp + 1 days, nonce, v, r, s);

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

    function signAuth(
        uint256 signerKey,
        address from,
        address to,
        uint256 value,
        bytes32 nonce
    ) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        bytes32 digest = token.authorizationDigest(from, to, value, block.timestamp, block.timestamp + 1 days, nonce);
        return vm.sign(signerKey, digest);
    }
}
