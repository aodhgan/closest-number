// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Script, console} from "forge-std/Script.sol";
import {HotColdGame} from "../src/HotColdGame.sol";

contract UpdateBuyIn is Script {
    function run() external {
        address gameAddress = vm.envAddress("GAME_ADDRESS");
        uint256 newBuyIn = vm.envUint("NEW_BUY_IN_WEI");
        uint256 ownerPrivateKey = vm.envUint("PRIVATE_KEY");

        require(gameAddress != address(0), "Game address required");
        require(newBuyIn > 0, "New buy-in must be > 0");

        HotColdGame game = HotColdGame(payable(gameAddress));
        address caller = vm.addr(ownerPrivateKey);
        require(caller == game.owner(), "Caller must own contract");

        console.log("HotColdGame:", gameAddress);
        console.log("Current round:", game.currentRoundId());
        console.log("Existing buy-in:", game.rounds(game.currentRoundId()).buyIn);
        console.log("Updating buy-in to:", newBuyIn);

        vm.startBroadcast(ownerPrivateKey);
        game.updateBuyIn(newBuyIn);
        vm.stopBroadcast();

        console.log("Buy-in updated to:", game.rounds(game.currentRoundId()).buyIn);
    }
}
