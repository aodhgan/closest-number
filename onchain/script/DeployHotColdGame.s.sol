// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Script, console} from "forge-std/Script.sol";
import {HotColdGame} from "../src/HotColdGame.sol";

contract DeployHotColdGame is Script {
    function run() external returns (HotColdGame game) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        uint256 initialBuyIn = vm.envOr("INITIAL_BUY_IN_WEI", uint256(0.01 ether));
        address teeAddress = vm.envAddress("TEE_ADDRESS");
        require(initialBuyIn > 0, "Initial buy-in must be > 0");
        require(teeAddress != address(0), "TEE_ADDRESS required");

        vm.startBroadcast(deployerPrivateKey);
        game = new HotColdGame(initialBuyIn, teeAddress);
        vm.stopBroadcast();

        console.log("HotColdGame deployed at:", address(game));
        console.log("Deployer address:", vm.addr(deployerPrivateKey));
        console.log("Owner:", game.owner());
        console.log("TEE:", game.tee());
        console.log("Round:", game.currentRoundId());
        console.log("Buy-in:", game.rounds(game.currentRoundId()).buyIn);
    }
}
