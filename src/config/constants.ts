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
export const HOT_COLD_CONTRACT_ADDRESS = (process.env.HOT_COLD_CONTRACT_ADDRESS as `0x${string}`) || null;
export const CHAIN_ID = process.env.CHAIN_ID ? parseInt(process.env.CHAIN_ID, 10) : 84532;

// Legacy exports retained for compatibility with unused modules
export const RPC_URL = process.env.RPC_URL || null;
export const ESCROW_CONTRACT_ADDRESS = (process.env.ESCROW_CONTRACT_ADDRESS as `0x${string}`) || null;
export const MNEMONIC = process.env.MNEMONIC || null;
