# HotColdGame Contract

A lightweight on-chain companion for the hot–cold enclave lottery. The contract collects per-guess buy-ins, lets the TEE coordinator adjust pricing as guesses heat up, and pays the full pot to the first winner recorded by the enclave.

## Overview
- **payForGuess**: Players prepay the current buy-in before submitting their off-chain guess.
- **updateBuyIn**: The TEE controller can raise/lower the buy-in for the active round.
- **settleWinner**: Pays the entire pot to the provided winner and closes the round.
- **startNextRound**: Opens a fresh round after the active one is closed or settled.
- **closeActiveRound + withdrawIdle**: Emergency controls to pause payouts and recover idle funds without touching an active pot.

The contract is intentionally narrow: all game logic and hinting lives in the TEE backend. On-chain responsibilities are limited to pricing, escrow, and payouts.

## Key Functions

### Constructor
```solidity
constructor(address teeAddress, address paymentTokenAddress)
```
Configures the trusted enclave/TEE signer that controls pricing and settlement and pins the ERC20 payment token used for the game. Rounds are started explicitly via `startNextRound`.

### payForGuess
```solidity
function payForGuess(uint256 roundId) external payable
```
- Requires `roundId` to equal the current round.
- `msg.value` must match the active buy-in.
- Increments the round pot and guess counter, emitting `GuessPaid` for the enclave to observe.

### updateBuyIn
```solidity
function updateBuyIn(uint256 newBuyInWei) external onlyTee
```
Updates the price for the active round. Useful when the enclave marks a guess as "near" and wants to throttle brute force.

### settleWinner
```solidity
function settleWinner(address payable winner) external onlyTee
```
Pays the entire active pot to the winner, marks the round inactive, and records the winner address.

### startNextRound
```solidity
function startNextRound(uint256 buyInWei, bytes32 targetCommitment) external onlyTee returns (uint256)
```
Starts a new round after the prior one is inactive and anchors the enclave-provided commitment hash for the target.

### settleAndStartNextRound
```solidity
function settleAndStartNextRound(address payable winner, uint256 buyInWei, bytes32 targetCommitment)
    external
    onlyTee
    returns (uint256)
```
Closes the active round by paying the winner and immediately opens the next round with a fresh commitment.

### closeActiveRound
```solidity
function closeActiveRound() external onlyTee
```
Closes the current round without payout (e.g., operational pause). Funds remain in the contract until withdrawn via `withdrawIdle`.

### withdrawIdle
```solidity
function withdrawIdle(address payable to, uint256 amount) external onlyTee
```
Allows recovery of idle pot funds after a manual close while keeping accounting consistent.

### updateTee
```solidity
function updateTee(address newTee) external onlyOwner
```
Allows the owner to rotate the trusted TEE/controller address while keeping admin separation.

## Deployment

### Prerequisites
- [Foundry](https://book.getfoundry.sh/getting-started/installation)
- Private key with funds on the target network
- RPC URL for the target network

### Using the deployment script
From `onchain/`:
```bash
./scripts/deploy.sh \
  --rpc-url <RPC_URL> \
  --private-key <PRIVATE_KEY> \
  --tee-address <TEE_ADDRESS> \
  --payment-token-address <PAYMENT_TOKEN_ADDRESS> \
  --etherscan-api-key <API_KEY> \  # optional for verification
  --verify                         # optional
```

You can also supply `PRIVATE_KEY`, `RPC_URL`, `TEE_ADDRESS`, `PAYMENT_TOKEN_ADDRESS`, and `ETHERSCAN_API_KEY` as environment variables.

After deployment, the TEE must call `startNextRound` (or `settleAndStartNextRound`) to open the first round with its commitment.

### Adjusting buy-in
Use the helper script to bump the active buy-in:
```bash
./scripts/update-buyin.sh \
  --game-address <HOT_COLD_GAME_ADDRESS> \
  --new-buy-in-wei <NEW_PRICE> \
  --rpc-url <RPC_URL> \
  --private-key <TEE_PRIVATE_KEY>
```

### Manual forge commands
```bash
forge script script/DeployHotColdGame.s.sol:DeployHotColdGame --rpc-url <RPC_URL> --private-key <PRIVATE_KEY> --broadcast
forge script script/UpdateBuyIn.s.sol:UpdateBuyIn --rpc-url <RPC_URL> --private-key <PRIVATE_KEY> --broadcast
```

## Events
- `RoundStarted(uint256 roundId, uint256 buyIn, bytes32 targetCommitment)`
- `BuyInUpdated(uint256 roundId, uint256 newBuyIn)`
- `GuessPaid(uint256 roundId, address player, uint256 amount, uint256 potAfter, uint256 guessCount)`
- `WinnerPaid(uint256 roundId, address winner, uint256 payout)`

These events allow the enclave backend to monitor state changes and enforce pricing before accepting guesses.
