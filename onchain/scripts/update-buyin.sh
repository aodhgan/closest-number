#!/bin/bash

# Script to update the buy-in price on the HotColdGame contract
# Usage: ./scripts/update-buyin.sh [--game-address ADDRESS] [--new-buy-in-wei AMOUNT] [--rpc-url RPC_URL] [--private-key PRIVATE_KEY]

set -e

RPC_URL=""
PRIVATE_KEY=""
GAME_ADDRESS=""
NEW_BUY_IN_WEI=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --rpc-url)
            RPC_URL="$2"
            shift 2
            ;;
        --private-key)
            PRIVATE_KEY="$2"
            shift 2
            ;;
        --game-address)
            GAME_ADDRESS="$2"
            shift 2
            ;;
        --new-buy-in-wei)
            NEW_BUY_IN_WEI="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--game-address ADDRESS] [--new-buy-in-wei AMOUNT] [--rpc-url RPC_URL] [--private-key PRIVATE_KEY]"
            exit 1
            ;;
    esac
done

if [ -z "$PRIVATE_KEY" ]; then
    if [ -z "$PRIVATE_KEY_ENV" ]; then
        echo "Error: Private key must be provided via --private-key or PRIVATE_KEY environment variable"
        exit 1
    fi
    PRIVATE_KEY="$PRIVATE_KEY_ENV"
fi

if [ -z "$RPC_URL" ]; then
    if [ -z "$RPC_URL_ENV" ]; then
        echo "Error: RPC URL must be provided via --rpc-url or RPC_URL environment variable"
        exit 1
    fi
    RPC_URL="$RPC_URL_ENV"
fi

if [ -z "$GAME_ADDRESS" ]; then
    if [ -z "$GAME_ADDRESS_ENV" ]; then
        echo "Error: Game contract address must be provided via --game-address or GAME_ADDRESS environment variable"
        exit 1
    fi
    GAME_ADDRESS="$GAME_ADDRESS_ENV"
fi

if [ -z "$NEW_BUY_IN_WEI" ]; then
    if [ -z "$NEW_BUY_IN_WEI_ENV" ]; then
        echo "Error: New buy-in must be provided via --new-buy-in-wei or NEW_BUY_IN_WEI environment variable"
        exit 1
    fi
    NEW_BUY_IN_WEI="$NEW_BUY_IN_WEI_ENV"
fi

if [[ ! "$GAME_ADDRESS" =~ ^0x[a-fA-F0-9]{40}$ ]]; then
    echo "Error: Invalid game address format. Must be a valid Ethereum address (0x followed by 40 hex characters)"
    exit 1
fi

export PRIVATE_KEY
export RPC_URL
export GAME_ADDRESS
export NEW_BUY_IN_WEI

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ONCHAIN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ONCHAIN_DIR"

echo "Updating buy-in on HotColdGame..."
echo "Contract: $GAME_ADDRESS"
echo "New buy-in (wei): $NEW_BUY_IN_WEI"
echo "RPC URL: $RPC_URL"
forge script script/UpdateBuyIn.s.sol:UpdateBuyIn \
    --rpc-url "$RPC_URL" \
    --private-key "$PRIVATE_KEY" \
    --broadcast

echo ""
echo "Buy-in update complete!"
