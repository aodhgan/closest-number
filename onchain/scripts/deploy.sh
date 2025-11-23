#!/bin/bash

# Deployment script for HotColdGame contract
# Usage: ./scripts/deploy.sh [--rpc-url RPC_URL] [--private-key PRIVATE_KEY] [--tee-address ADDRESS] [--etherscan-api-key KEY] [--chain-id CHAIN_ID] [--verify] [--buy-in-wei AMOUNT]

set -e

# Parse command line arguments
RPC_URL=""
PRIVATE_KEY=""
ETHERSCAN_API_KEY=""
CHAIN_ID=""
VERIFY=false
INITIAL_BUY_IN=""
TEE_ADDRESS=""
PAYMENT_TOKEN_ADDRESS=""
INITIAL_TARGET_COMMITMENT=""

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
        --etherscan-api-key)
            ETHERSCAN_API_KEY="$2"
            VERIFY=true
            shift 2
            ;;
        --tee-address)
            TEE_ADDRESS="$2"
            shift 2
            ;;
        --payment-token-address)
            PAYMENT_TOKEN_ADDRESS="$2"
            shift 2
            ;;
        --initial-target-commitment)
            INITIAL_TARGET_COMMITMENT="$2"
            shift 2
            ;;
        --chain-id)
            CHAIN_ID="$2"
            shift 2
            ;;
        --verify)
            VERIFY=true
            shift
            ;;
        --buy-in-wei)
            INITIAL_BUY_IN="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--rpc-url RPC_URL] [--private-key PRIVATE_KEY] [--etherscan-api-key KEY] [--chain-id CHAIN_ID] [--verify] [--buy-in-wei AMOUNT] [--payment-token-address ADDRESS] [--initial-target-commitment 0xHASH]"
            exit 1
            ;;
    esac
done

# Check if private key is provided
if [ -z "$PRIVATE_KEY" ]; then
    if [ -z "$PRIVATE_KEY_ENV" ]; then
        echo "Error: Private key must be provided via --private-key or PRIVATE_KEY environment variable"
        exit 1
    fi
    PRIVATE_KEY="$PRIVATE_KEY_ENV"
fi

# Check if RPC URL is provided
if [ -z "$RPC_URL" ]; then
    if [ -z "$RPC_URL_ENV" ]; then
        echo "Error: RPC URL must be provided via --rpc-url or RPC_URL environment variable"
        exit 1
    fi
    RPC_URL="$RPC_URL_ENV"
fi

if [ -z "$TEE_ADDRESS" ]; then
    if [ -z "$TEE_ADDRESS_ENV" ]; then
        echo "Error: TEE address must be provided via --tee-address or TEE_ADDRESS environment variable"
        exit 1
    fi
    TEE_ADDRESS="$TEE_ADDRESS_ENV"
fi

if [ -z "$PAYMENT_TOKEN_ADDRESS" ]; then
    if [ -z "$PAYMENT_TOKEN_ADDRESS_ENV" ]; then
        echo "Error: Payment token address must be provided via --payment-token-address or PAYMENT_TOKEN_ADDRESS environment variable"
        exit 1
    fi
    PAYMENT_TOKEN_ADDRESS="$PAYMENT_TOKEN_ADDRESS_ENV"
fi

if [ -z "$INITIAL_TARGET_COMMITMENT" ]; then
    if [ -z "$INITIAL_TARGET_COMMITMENT_ENV" ]; then
        echo "Error: Target commitment must be provided via --initial-target-commitment or INITIAL_TARGET_COMMITMENT environment variable"
        exit 1
    fi
    INITIAL_TARGET_COMMITMENT="$INITIAL_TARGET_COMMITMENT_ENV"
fi

# Check for Etherscan API key from environment (if not provided via flag)
# Foundry automatically uses ETHERSCAN_API_KEY environment variable when --verify is used
if [ -z "$ETHERSCAN_API_KEY" ]; then
    # Check if ETHERSCAN_API_KEY exists in environment
    if [ -n "${ETHERSCAN_API_KEY:-}" ]; then
        # API key exists in environment, Foundry will use it automatically
        # Don't set VERIFY=true here, let user explicitly request with --verify flag
        :
    fi
fi

# If verify is requested, ensure we have an API key (either from flag or env)
if [ "$VERIFY" = true ]; then
    if [ -z "$ETHERSCAN_API_KEY" ] && [ -z "${ETHERSCAN_API_KEY:-}" ]; then
        echo "Warning: --verify specified but no Etherscan API key provided."
        echo "Skipping verification. Provide --etherscan-api-key or set ETHERSCAN_API_KEY environment variable."
        VERIFY=false
    fi
fi

# Export environment variables for forge script
export PRIVATE_KEY
export RPC_URL
if [ -n "$ETHERSCAN_API_KEY" ]; then
    export ETHERSCAN_API_KEY
fi
if [ -n "$INITIAL_BUY_IN" ]; then
    export INITIAL_BUY_IN_WEI="$INITIAL_BUY_IN"
fi
if [ -n "$TEE_ADDRESS" ]; then
    export TEE_ADDRESS
fi
if [ -n "$PAYMENT_TOKEN_ADDRESS" ]; then
    export PAYMENT_TOKEN_ADDRESS
fi
if [ -n "$INITIAL_TARGET_COMMITMENT" ]; then
    export INITIAL_TARGET_COMMITMENT
fi

# Get the script directory and change to onchain directory
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ONCHAIN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ONCHAIN_DIR"

# Run the deployment script
echo "Deploying HotColdGame contract..."
echo "RPC URL: $RPC_URL"
echo "Deployer address will be derived from private key"
echo "TEE address: $TEE_ADDRESS"
echo "Payment token: $PAYMENT_TOKEN_ADDRESS"
echo "Initial commitment: $INITIAL_TARGET_COMMITMENT"
if [ "$VERIFY" = true ] && [ -n "$ETHERSCAN_API_KEY" ]; then
    echo "Verification: Enabled"
    if [ -n "$CHAIN_ID" ]; then
        echo "Chain ID: $CHAIN_ID"
    fi
fi
echo ""

# Build forge command
FORGE_CMD="forge script script/DeployHotColdGame.s.sol:DeployHotColdGame \
    --rpc-url \"$RPC_URL\" \
    --private-key \"$PRIVATE_KEY\" \
    --broadcast"

# Add verification if enabled
if [ "$VERIFY" = true ] && [ -n "$ETHERSCAN_API_KEY" ]; then
    FORGE_CMD="$FORGE_CMD --verify"
    if [ -n "$CHAIN_ID" ]; then
        FORGE_CMD="$FORGE_CMD --chain-id $CHAIN_ID"
    fi
fi

# Execute the command
eval $FORGE_CMD

echo ""
echo "Deployment complete!"
if [ "$VERIFY" = true ] && [ -n "$ETHERSCAN_API_KEY" ]; then
    echo "Contract verification submitted to Etherscan"
fi

