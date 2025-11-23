// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Script, console} from "forge-std/Script.sol";
import {HotColdGame} from "../src/HotColdGame.sol";

contract DeployHotColdGame is Script {
    function run() external returns (HotColdGame game) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address teeAddress = vm.envAddress("TEE_ADDRESS");
        address paymentToken = vm.envAddress("PAYMENT_TOKEN_ADDRESS");
        require(teeAddress != address(0), "TEE_ADDRESS required");
        require(paymentToken != address(0), "PAYMENT_TOKEN_ADDRESS required");

        vm.startBroadcast(deployerPrivateKey);
        game = new HotColdGame(teeAddress, paymentToken);
        vm.stopBroadcast();

        console.log("HotColdGame deployed at:", address(game));
        console.log("Deployer address:", vm.addr(deployerPrivateKey));
        console.log("Owner:", game.owner());
        console.log("TEE:", game.tee());
        console.log("Round:", game.currentRoundId());
    }
}
