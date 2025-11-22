/**
 * @file constants.ts
 * @description Configuration constants for the hot-cold enclave server
 */

export const SERVER_PORT = process.env.APP_PORT || 8000;

// Game defaults
export const TARGET_DIGITS = parseInt(process.env.TARGET_DIGITS || '12', 10);
export const MIN_TARGET_DIGITS = 4;
export const MAX_TARGET_DIGITS = 18;
export const BASE_BUY_IN_WEI = process.env.BASE_BUY_IN_WEI || '1000000000000000'; // 0.001 ETH
export const NEAR_MATCH_THRESHOLD = parseInt(process.env.NEAR_MATCH_THRESHOLD || '4', 10);
export const PRICE_INCREASE_BPS = parseInt(process.env.PRICE_INCREASE_BPS || '1500', 10); // 15%
export const MAX_PRICE_STEPS = parseInt(process.env.MAX_PRICE_STEPS || '6', 10);

// Onchain integration
export const HOT_COLD_CONTRACT_ADDRESS = "0xa8f82aC3C52D959D20a9722d7CAe913d46f69a7A"
export const CHAIN_ID = 84532;
export const PAYMENT_TOKEN_ADDRESS = "0xE71aC8e30C5f7671eb96Fa089aC0B8b926798Dd1";
export const PAYMENT_TOKEN_NAME = process.env.PAYMENT_TOKEN_NAME || 'MockPermit';
export const PAYMENT_TOKEN_SYMBOL = process.env.PAYMENT_TOKEN_SYMBOL || 'MCK';
export const PAYMENT_TOKEN_VERSION = process.env.PAYMENT_TOKEN_VERSION || '1';
export const TEE_PRIVATE_KEY = process.env.TEE_PRIVATE_KEY || null;

// Legacy exports retained for compatibility with unused modules
export const RPC_URL = process.env.RPC_URL || null;
export const ESCROW_CONTRACT_ADDRESS = (process.env.ESCROW_CONTRACT_ADDRESS as `0x${string}`) || null;
export const MNEMONIC = process.env.MNEMONIC || null;
