// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Script, console} from "forge-std/Script.sol";
import {MockPermitToken} from "../test/HotColdGame.t.sol";

contract DeployToken is Script {
    function run() external returns (MockPermitToken token) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);
        token = new MockPermitToken();
        vm.stopBroadcast();
        console.log("Token deployed at:", address(token));
    }
}
