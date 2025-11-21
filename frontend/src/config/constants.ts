/**
 * @file config/constants.ts
 * @description Frontend configuration constants
 * 
 * This file centralizes all configuration that comes from environment variables.
 * Vite requires environment variables to be prefixed with VITE_ to be exposed to the client.
 */

/**
 * TEE Server Base URL
 * Why: This is the base URL of the TEE server API. All API calls will be made to this URL.
 * Must be set in .env.local file.
 */
export const TEE_SERVER_URL = import.meta.env.VITE_TEE_SERVER_URL || 'http://localhost:8000';

/**
 * Privy App ID
 * Why: Privy requires an app ID to initialize the authentication client.
 * Get this from your Privy dashboard: https://dashboard.privy.io
 */
export const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID || '';

/**
 * Blockchain RPC URL
 * Why: We need a connection to the blockchain to read balances, interact with contracts,
 * and query blockchain data. This must be set to match the network where your Escrow
 * contract is deployed (e.g., Base Sepolia: https://sepolia.base.org).
 * 
 * Required: Yes - must be set in .env.local file
 */
export const RPC_URL = import.meta.env.VITE_RPC_URL || null;

/**
 * Chain ID (optional, defaults to Base Sepolia)
 * Why: Privy needs to know which blockchain network to connect to.
 * Defaults to Base Sepolia testnet (84532) if not specified.
 */
export const CHAIN_ID = import.meta.env.VITE_CHAIN_ID
  ? parseInt(import.meta.env.VITE_CHAIN_ID)
  : 84532; // Base Sepolia testnet

/**
 * HotColdGame contract address
 * Why: Needed to direct users to pay the buy-in with payForGuess before submitting a guess.
 */
export const HOT_COLD_GAME_ADDRESS = import.meta.env.VITE_HOT_COLD_GAME_ADDRESS || '';

export const PAYMENT_TOKEN_ADDRESS = import.meta.env.VITE_PAYMENT_TOKEN_ADDRESS || '';
export const PAYMENT_TOKEN_NAME = import.meta.env.VITE_PAYMENT_TOKEN_NAME || 'MockPermit';
export const PAYMENT_TOKEN_SYMBOL = import.meta.env.VITE_PAYMENT_TOKEN_SYMBOL || 'MCK';
export const PAYMENT_TOKEN_VERSION = import.meta.env.VITE_PAYMENT_TOKEN_VERSION || '1';

/**
 * Validate configuration on import
 * Why: We want to fail fast if required configuration is missing.
 * This helps developers catch configuration errors early.
 */
if (!PRIVY_APP_ID) {
  console.warn('⚠️  VITE_PRIVY_APP_ID is not set. Privy authentication will not work.');
}

if (!TEE_SERVER_URL || TEE_SERVER_URL === 'http://localhost:8000') {
  console.warn('⚠️  VITE_TEE_SERVER_URL is using default localhost. Make sure your TEE server is running.');
}

if (!RPC_URL) {
  console.error('❌ VITE_RPC_URL is not set. Blockchain operations will not work.');
}

