import crypto from 'crypto';
import { Address, Hex, createPublicClient, createWalletClient, decodeEventLog, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import {
  BASE_BUY_IN_WEI,
  MAX_PRICE_STEPS,
  MIN_TARGET_DIGITS,
  MAX_TARGET_DIGITS,
  NEAR_MATCH_THRESHOLD,
  PRICE_INCREASE_BPS,
  TARGET_DIGITS,
  HOT_COLD_CONTRACT_ADDRESS,
  RPC_URL,
  CHAIN_ID,
  PAYMENT_TOKEN_ADDRESS,
  PAYMENT_TOKEN_NAME,
  PAYMENT_TOKEN_SYMBOL,
  PAYMENT_TOKEN_VERSION,
  TEE_PRIVATE_KEY,
} from '../config/constants';

export interface GuessRecord {
  player: string;
  guess: string;
  stakeWei: bigint;
  distance: number;
  matches: number;
  hint: string;
  createdAt: string;
  priceStepAtGuess: number;
}

export interface GameRoundState {
  roundId: string;
  digits: number;
  sealedHash: string;
  targetSecret: string;
  buyInWei: bigint;
  potWei: bigint;
  guesses: GuessRecord[];
  priceSteps: number;
  nearMatchThreshold: number;
  priceIncreaseBps: number;
  distanceMetric: 'exact-position-matches';
  winner?: GuessRecord & { payoutWei: bigint };
  startedAt: string;
  targetDigest: string;
}

interface GuessPayment {
  roundId: bigint;
  amount: bigint;
  potAfter: bigint;
  guessCount: bigint;
  buyInWei: bigint;
}

export interface AuthorizationPayload {
  roundId: string;
  payer: Address;
  validAfter: string;
  validBefore: string;
  nonce: Hex;
  v: number;
  r: Hex;
  s: Hex;
}

interface OnchainRoundState {
  buyIn: bigint;
  pot: bigint;
  guesses: bigint;
  winner: Address;
  active: boolean;
}

const TEN = BigInt(10);

const hotColdAbi = [
  {
    type: 'event',
    name: 'GuessPaid',
    inputs: [
      { name: 'roundId', type: 'uint256', indexed: true },
      { name: 'player', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'potAfter', type: 'uint256', indexed: false },
      { name: 'guessCount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'function',
    name: 'payForGuess',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'roundId', type: 'uint256' },
      { name: 'payer', type: 'address' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'currentRoundId',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'rounds',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [
      { name: 'buyIn', type: 'uint256' },
      { name: 'pot', type: 'uint256' },
      { name: 'guesses', type: 'uint256' },
      { name: 'winner', type: 'address' },
      { name: 'active', type: 'bool' },
    ],
  },
  {
    type: 'function',
    name: 'paymentToken',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;

const chain = CHAIN_ID === baseSepolia.id ? baseSepolia : undefined;
const publicClient = RPC_URL ? createPublicClient({ chain, transport: http(RPC_URL) }) : null;
const walletAccount = TEE_PRIVATE_KEY ? privateKeyToAccount(TEE_PRIVATE_KEY as Hex) : null;
const walletClient = RPC_URL && walletAccount ? createWalletClient({ account: walletAccount, chain, transport: http(RPC_URL) }) : null;

function clampDigits(value: number): number {
  if (Number.isNaN(value)) return TARGET_DIGITS;
  return Math.min(Math.max(value, MIN_TARGET_DIGITS), MAX_TARGET_DIGITS);
}

function randomDigits(length: number): string {
  const bytes = crypto.randomBytes(length);
  const digits = Array.from(bytes)
    .slice(0, length)
    .map((b) => (b % 10).toString())
    .join('');
  return digits.padStart(length, '0').slice(0, length);
}

function sealTarget(roundId: string, target: string): string {
  const hash = crypto.createHash('sha256');
  hash.update(roundId);
  hash.update(':');
  hash.update(target);
  return hash.digest('hex');
}

function computeMatches(target: string, guess: string): number {
  let matches = 0;
  for (let i = 0; i < target.length; i += 1) {
    if (target[i] === guess[i]) {
      matches += 1;
    }
  }
  return matches;
}

function parseWei(amount: string): bigint {
  const trimmed = amount.trim();
  if (!/^\d+(\.\d{0,18})?$/.test(trimmed)) {
    throw new Error('Amount must be a numeric string with up to 18 decimals');
  }
  if (!trimmed.includes('.')) {
    return BigInt(trimmed);
  }
  const [whole, fractional] = trimmed.split('.');
  const paddedFractional = (fractional || '').padEnd(18, '0').slice(0, 18);
  return BigInt(whole) * TEN ** BigInt(18) + BigInt(paddedFractional);
}

function formatEth(amountWei: bigint): string {
  const negative = amountWei < 0;
  const absolute = negative ? -amountWei : amountWei;
  const whole = absolute / TEN ** BigInt(18);
  const fraction = absolute % TEN ** BigInt(18);
  const fractionStr = fraction.toString().padStart(18, '0').replace(/0+$/, '');
  const value = fractionStr.length ? `${whole}.${fractionStr}` : whole.toString();
  return negative ? `-${value}` : value;
}

class GameService {
  private state: GameRoundState;

  private processedPayments: Set<string> = new Set();

  constructor() {
    this.state = this.createRound();
    void this.trySyncFromChain();
  }

  private createRound(overrides: Partial<GameRoundState> = {}): GameRoundState {
    const digits = clampDigits(TARGET_DIGITS);
    const target = randomDigits(digits);
    const roundId = overrides.roundId ?? crypto.randomUUID();
    const buyInWei = overrides.buyInWei ?? parseWei(BASE_BUY_IN_WEI);
    const sealedHash = sealTarget(roundId, overrides.targetSecret ?? target);

    return {
      roundId,
      digits,
      sealedHash,
      targetSecret: overrides.targetSecret ?? target,
      buyInWei,
      potWei: overrides.potWei ?? BigInt(0),
      guesses: overrides.guesses ?? [],
      priceSteps: overrides.priceSteps ?? 0,
      nearMatchThreshold: overrides.nearMatchThreshold ?? NEAR_MATCH_THRESHOLD,
      priceIncreaseBps: overrides.priceIncreaseBps ?? PRICE_INCREASE_BPS,
      distanceMetric: 'exact-position-matches',
      startedAt: overrides.startedAt ?? new Date().toISOString(),
      targetDigest: overrides.targetDigest ?? sealedHash,
      winner: overrides.winner,
    };
  }

  private ensureOnchainClient(): {
    client: NonNullable<typeof publicClient>;
    wallet: NonNullable<typeof walletClient>;
    address: Address;
    token: Address;
  } {
    if (!publicClient || !RPC_URL) {
      throw new Error('RPC_URL must be configured to verify payments');
    }
    if (!walletClient) {
      throw new Error('TEE_PRIVATE_KEY must be configured to submit payments');
    }
    if (!HOT_COLD_CONTRACT_ADDRESS) {
      throw new Error('HOT_COLD_CONTRACT_ADDRESS must be configured to verify payments');
    }
    if (!PAYMENT_TOKEN_ADDRESS) {
      throw new Error('PAYMENT_TOKEN_ADDRESS must be configured to verify payments');
    }
    return { client: publicClient, wallet: walletClient, address: HOT_COLD_CONTRACT_ADDRESS, token: PAYMENT_TOKEN_ADDRESS };
  }

  private async readRoundFromChain(roundId: bigint): Promise<OnchainRoundState> {
    const { client, address } = this.ensureOnchainClient();
    const result = await client.readContract({
      address,
      abi: hotColdAbi,
      functionName: 'rounds',
      args: [roundId],
    });
    const [buyIn, pot, guesses, winner, active] = result as unknown as [bigint, bigint, bigint, Address, boolean];
    return { buyIn, pot, guesses, winner, active };
  }

  private async trySyncFromChain() {
    try {
      const { client, address } = this.ensureOnchainClient();
      const chainRoundId = await client.readContract({ address, abi: hotColdAbi, functionName: 'currentRoundId' });
      const onchainRound = await this.readRoundFromChain(chainRoundId as bigint);
      this.state = this.createRound({
        roundId: (chainRoundId as bigint).toString(),
        buyInWei: onchainRound.buyIn,
        potWei: onchainRound.pot,
        guesses: [],
      });
      this.processedPayments.clear();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('On-chain sync skipped:', (err as Error).message);
    }
  }

  public getState(): GameRoundState {
    return this.state;
  }

  public resetRound(): GameRoundState {
    this.processedPayments.clear();
    this.state = this.createRound();
    return this.state;
  }

  public async submitGuess({
    guess,
    player,
    authorization,
  }: {
    guess: string;
    player: string;
    authorization: AuthorizationPayload;
  }): Promise<{ state: GameRoundState; guess: GuessRecord; payout?: { winner: string; amountWei: string } }> {
    const normalizedGuess = guess.trim();
    if (!/^\d+$/.test(normalizedGuess)) {
      throw new Error('Guess must be a numeric string');
    }

    const payment = await this.executeGuessPayment({ player, authorization });

    if (this.state.roundId !== payment.roundId.toString()) {
      await this.resetRoundForChain(payment.roundId);
    }

    if (this.state.winner) {
      throw new Error('Round already settled');
    }

    if (normalizedGuess.length !== this.state.digits) {
      throw new Error(`Guess must be exactly ${this.state.digits} digits long`);
    }

    this.state.buyInWei = payment.buyInWei;
    this.state.potWei = payment.potAfter;

    const stake = payment.amount;
    const matches = computeMatches(this.state.targetSecret, normalizedGuess);
    const distance = this.state.digits - matches;
    const hint = `${matches}/${this.state.digits} digits in place`;

    const guessRecord: GuessRecord = {
      player,
      guess: normalizedGuess,
      stakeWei: stake,
      matches,
      distance,
      hint,
      createdAt: new Date().toISOString(),
      priceStepAtGuess: this.state.priceSteps,
    };

    let payout: { winner: string; amountWei: string } | undefined;

    if (matches === this.state.digits) {
      this.state.winner = {
        ...guessRecord,
        payoutWei: this.state.potWei,
      };
      payout = { winner: player, amountWei: this.state.potWei.toString() };
    }

    if (!this.state.winner && matches >= this.state.nearMatchThreshold && this.state.priceSteps < MAX_PRICE_STEPS) {
      const stepIncrease = (this.state.buyInWei * BigInt(PRICE_INCREASE_BPS)) / BigInt(10000);
      this.state.buyInWei += stepIncrease;
      this.state.priceSteps += 1;
    }

    this.state.guesses.unshift(guessRecord);
    const nonceKey = `${authorization.payer.toLowerCase()}:${authorization.nonce.toLowerCase()}`;
    this.processedPayments.add(nonceKey);

    return { state: this.state, guess: guessRecord, payout };
  }

  private async resetRoundForChain(roundId: bigint) {
    const onchain = await this.readRoundFromChain(roundId);
    this.state = this.createRound({
      roundId: roundId.toString(),
      buyInWei: onchain.buyIn,
      potWei: onchain.pot,
      guesses: [],
      priceSteps: 0,
      startedAt: new Date().toISOString(),
      winner: undefined,
    });
    this.processedPayments.clear();
  }

  private async executeGuessPayment({
    player,
    authorization,
  }: {
    player: string;
    authorization: AuthorizationPayload;
  }): Promise<GuessPayment> {
    const normalizedPlayer = player.toLowerCase();
    if (authorization.payer.toLowerCase() !== normalizedPlayer) {
      throw new Error('Authorization signer does not match player');
    }
    if (!authorization.nonce || !authorization.validAfter || !authorization.validBefore) {
      throw new Error('Authorization is missing required fields');
    }

    const nonceKey = `${authorization.payer.toLowerCase()}:${authorization.nonce.toLowerCase()}`;
    if (this.processedPayments.has(nonceKey)) {
      throw new Error('Authorization already used for a guess');
    }

    const { client, wallet, address } = this.ensureOnchainClient();
    const currentRoundId = (await client.readContract({ address, abi: hotColdAbi, functionName: 'currentRoundId' })) as bigint;
    const roundId = authorization.roundId ? BigInt(authorization.roundId) : currentRoundId;

    const txHash = await wallet.writeContract({
      address,
      abi: hotColdAbi,
      functionName: 'payForGuess',
      args: [
        roundId,
        authorization.payer,
        BigInt(authorization.validAfter),
        BigInt(authorization.validBefore),
        authorization.nonce,
        authorization.v,
        authorization.r,
        authorization.s,
      ],
    });

    const receipt = await client.waitForTransactionReceipt({ hash: txHash });

    if (receipt.status !== 'success') {
      throw new Error('Payment transaction failed or reverted');
    }

    const relevantLogs = receipt.logs.filter((log) => log.address.toLowerCase() === address.toLowerCase());

    for (const log of relevantLogs) {
      try {
        const decoded = decodeEventLog({ abi: hotColdAbi, data: log.data, topics: log.topics });
        if (decoded.eventName === 'GuessPaid') {
          const { roundId: paidRoundId, player: paidPlayer, amount, potAfter, guessCount } = decoded.args as {
            roundId: bigint;
            player: Address;
            amount: bigint;
            potAfter: bigint;
            guessCount: bigint;
          };

          if (paidPlayer.toLowerCase() !== player.toLowerCase()) {
            continue;
          }

          const onchain = await this.readRoundFromChain(paidRoundId);
          return {
            roundId: paidRoundId,
            amount,
            potAfter,
            guessCount,
            buyInWei: onchain.buyIn,
          };
        }
      } catch (err) {
        // Skip non-matching logs
        // eslint-disable-next-line no-continue
        continue;
      }
    }

    throw new Error('GuessPaid event not found for submitted authorization');
  }

  public getPublicState() {
    const { targetDigest, targetSecret, buyInWei, potWei, winner, guesses, ...rest } = this.state;
    const sanitizedGuesses = guesses.map((g) => ({
      ...g,
      stakeEth: formatEth(g.stakeWei),
      stakeWei: g.stakeWei.toString(),
    }));

    return {
      ...rest,
      guesses: sanitizedGuesses,
      buyInWei: buyInWei.toString(),
      potWei: potWei.toString(),
      buyInEth: formatEth(buyInWei),
      potEth: formatEth(potWei),
      paymentTokenSymbol: PAYMENT_TOKEN_SYMBOL,
      paymentTokenAddress: PAYMENT_TOKEN_ADDRESS,
      sealedTargetHash: targetDigest,
      winner: winner
        ? {
            ...winner,
            payoutWei: winner.payoutWei.toString(),
            stakeEth: formatEth(winner.stakeWei),
            stakeWei: winner.stakeWei.toString(),
          }
        : undefined,
    };
  }
}

export const gameService = new GameService();
export const formatWei = formatEth;
