import crypto from 'crypto';
import {
  BASE_BUY_IN_WEI,
  MAX_PRICE_STEPS,
  MIN_TARGET_DIGITS,
  MAX_TARGET_DIGITS,
  NEAR_MATCH_THRESHOLD,
  PRICE_INCREASE_BPS,
  TARGET_DIGITS,
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

const TEN = BigInt(10);

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

  constructor() {
    this.state = this.createRound();
  }

  private createRound(): GameRoundState {
    const digits = clampDigits(TARGET_DIGITS);
    const target = randomDigits(digits);
    const roundId = crypto.randomUUID();
    const sealedHash = sealTarget(roundId, target);
    const buyInWei = parseWei(BASE_BUY_IN_WEI);

    return {
      roundId,
      digits,
      sealedHash,
      targetSecret: target,
      buyInWei,
      potWei: BigInt(0),
      guesses: [],
      priceSteps: 0,
      nearMatchThreshold: NEAR_MATCH_THRESHOLD,
      priceIncreaseBps: PRICE_INCREASE_BPS,
      distanceMetric: 'exact-position-matches',
      startedAt: new Date().toISOString(),
      targetDigest: sealedHash,
      winner: undefined,
    };
  }

  public getState(): GameRoundState {
    return this.state;
  }

  public resetRound(): GameRoundState {
    this.state = this.createRound();
    return this.state;
  }

  public submitGuess({
    guess,
    player,
    stakeWei,
  }: {
    guess: string;
    player: string;
    stakeWei: string;
  }): { state: GameRoundState; guess: GuessRecord; payout?: { winner: string; amountWei: string } } {
    if (this.state.winner) {
      throw new Error('Round already settled');
    }

    const normalizedGuess = guess.trim();
    if (!/^\d+$/.test(normalizedGuess)) {
      throw new Error('Guess must be a numeric string');
    }
    if (normalizedGuess.length !== this.state.digits) {
      throw new Error(`Guess must be exactly ${this.state.digits} digits long`);
    }

    const stake = parseWei(stakeWei);
    if (stake < this.state.buyInWei) {
      throw new Error(`Stake must be at least current buy-in of ${formatEth(this.state.buyInWei)} ETH`);
    }

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

    this.state.potWei += stake;

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

    return { state: this.state, guess: guessRecord, payout };
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
