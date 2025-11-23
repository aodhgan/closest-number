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
  targetCommitment?: TargetCommitment;
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
  value: string;
  deadline: string;
  nonce: string;
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
  targetCommitment: Hex;
}

interface TargetCommitment {
  digest: string;
  message: string;
  signature?: Hex;
  signer?: Address;
  committedAt?: string;
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
      { name: 'value', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'settleWinner',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'winner', type: 'address' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'settleAndStartNextRound',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'winner', type: 'address' },
      { name: 'buyInWei', type: 'uint256' },
      { name: 'targetCommitment', type: 'bytes32' },
    ],
    outputs: [{ name: 'newRoundId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'startNextRound',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'buyInWei', type: 'uint256' },
      { name: 'targetCommitment', type: 'bytes32' },
    ],
    outputs: [{ name: 'newRoundId', type: 'uint256' }],
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
      { name: 'targetCommitment', type: 'bytes32' },
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

function digestToBytes32(digest: string): Hex {
  const normalized = digest.startsWith('0x') ? digest.slice(2) : digest;
  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error('Target commitment digest must be a 32-byte hex string');
  }
  return `0x${normalized}` as Hex;
}

class GameService {
  private state: GameRoundState;

  private processedPayments: Set<string> = new Set();

  constructor() {
    this.state = this.createRound();
    void this.commitTargetDigest(this.state);
    void this.ensureRoundIsReady();
  }

  private createRound(overrides: Partial<GameRoundState> = {}): GameRoundState {
    const digits = clampDigits(TARGET_DIGITS);
    const target = randomDigits(digits);
    const roundId = overrides.roundId ?? crypto.randomUUID();
    const buyInWei = overrides.buyInWei ?? parseWei(BASE_BUY_IN_WEI);
    const targetSecret = overrides.targetSecret ?? target;
    const targetDigest = overrides.targetDigest ?? sealTarget(roundId, targetSecret);
    const sealedHash = overrides.sealedHash ?? targetDigest;
    const startedAt = overrides.startedAt ?? new Date().toISOString();
    const commitment = overrides.targetCommitment ?? this.buildCommitment(roundId, targetDigest, startedAt);

    return {
      roundId,
      digits,
      sealedHash,
      targetSecret,
      buyInWei,
      potWei: overrides.potWei ?? BigInt(0),
      guesses: overrides.guesses ?? [],
      priceSteps: overrides.priceSteps ?? 0,
      nearMatchThreshold: overrides.nearMatchThreshold ?? NEAR_MATCH_THRESHOLD,
      priceIncreaseBps: overrides.priceIncreaseBps ?? PRICE_INCREASE_BPS,
      distanceMetric: 'exact-position-matches',
      startedAt,
      targetDigest,
      targetCommitment: commitment,
      winner: overrides.winner,
    };
  }

  private buildCommitment(roundId: string, digest: string, startedAt: string): TargetCommitment {
    return {
      digest,
      message: `HotCold target commitment for round ${roundId}: ${digest}`,
      committedAt: startedAt,
    };
  }

  private getCommitmentDigest(round: GameRoundState): string {
    return round.targetCommitment?.digest ?? round.targetDigest;
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

  private async commitTargetDigest(round: GameRoundState) {
    const baseCommitment = round.targetCommitment ?? this.buildCommitment(round.roundId, round.targetDigest, round.startedAt);

    if (baseCommitment.signature) {
      round.targetCommitment = baseCommitment;
      return;
    }

    if (!walletAccount) {
      // eslint-disable-next-line no-console
      console.warn('TEE_PRIVATE_KEY not configured; skipping target commitment signature');
      round.targetCommitment = baseCommitment;
      return;
    }

    try {
      const signature = await walletAccount.signMessage({ message: baseCommitment.message });
      round.targetCommitment = {
        ...baseCommitment,
        signature,
        signer: walletAccount.address,
        committedAt: baseCommitment.committedAt ?? new Date().toISOString(),
      };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('Failed to sign target commitment:', (err as Error).message);
      round.targetCommitment = baseCommitment;
    }
  }

  private async readRoundFromChain(roundId: bigint): Promise<OnchainRoundState> {
    const { client, address } = this.ensureOnchainClient();
    const result = await client.readContract({
      address,
      abi: hotColdAbi,
      functionName: 'rounds',
      args: [roundId],
    });
    const [buyIn, pot, guesses, winner, active, targetCommitment] = result as unknown as [
      bigint,
      bigint,
      bigint,
      Address,
      boolean,
      Hex,
    ];
    return { buyIn, pot, guesses, winner, active, targetCommitment };
  }

  private async ensureRoundIsReady() {
    try {
      const { client, address } = this.ensureOnchainClient();
      const chainRoundId = (await client.readContract({ address, abi: hotColdAbi, functionName: 'currentRoundId' })) as bigint;
      const now = new Date().toISOString();

      if (chainRoundId === 0n) {
        const nextState = this.createRound({ roundId: '1', startedAt: now });
        await this.commitTargetDigest(nextState);
        await this.startRoundOnChain(address, nextState);
        return;
      }

      const onchainRound = await this.readRoundFromChain(chainRoundId);
      if (!onchainRound.active) {
        const nextRoundId = chainRoundId + 1n;
        const nextState = this.createRound({ roundId: nextRoundId.toString(), startedAt: now });
        await this.commitTargetDigest(nextState);
        await this.startRoundOnChain(address, nextState);
        return;
      }

      const targetCommitment = this.createCommitmentFromOnchain(chainRoundId, onchainRound.targetCommitment, now);
      const restoredSecret = this.state?.targetSecret;
      const roundId = chainRoundId.toString();
      const matchingSecret = restoredSecret && sealTarget(roundId, restoredSecret) === targetCommitment.digest ? restoredSecret : undefined;

      this.state = this.createRound({
        roundId,
        buyInWei: onchainRound.buyIn,
        potWei: onchainRound.pot,
        guesses: [],
        priceSteps: 0,
        startedAt: now,
        targetDigest: targetCommitment.digest,
        sealedHash: targetCommitment.digest,
        targetSecret: matchingSecret,
        targetCommitment,
      });
      await this.commitTargetDigest(this.state);
      this.processedPayments.clear();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('On-chain bootstrap skipped:', (err as Error).message);
    }
  }

  private createCommitmentFromOnchain(roundId: bigint, commitment: Hex, startedAt: string): TargetCommitment {
    const digest = commitment.toString().replace(/^0x/, '');
    return {
      digest,
      message: `HotCold target commitment for round ${roundId.toString()}: ${digest}`,
      committedAt: startedAt,
    };
  }

  private async startRoundOnChain(contractAddress: Address, round: GameRoundState) {
    const { client, wallet } = this.ensureOnchainClient();
    const commitmentDigest = this.getCommitmentDigest(round);
    const txHash = await wallet.writeContract({
      address: contractAddress,
      abi: hotColdAbi,
      functionName: 'startNextRound',
      args: [round.buyInWei, digestToBytes32(commitmentDigest)],
    });

    const receipt = await client.waitForTransactionReceipt({ hash: txHash });

    if (receipt.status !== 'success') {
      throw new Error('Failed to start round on-chain');
    }

    this.state = round;
    this.processedPayments.clear();
  }

  private async settleAndOpenNextRound(winner: Address, concludedRoundId: bigint) {
    const { client, wallet, address } = this.ensureOnchainClient();
    const nextRoundId = concludedRoundId + 1n;
    const startedAt = new Date().toISOString();
    const nextState = this.createRound({ roundId: nextRoundId.toString(), startedAt });
    await this.commitTargetDigest(nextState);

    const txHash = await wallet.writeContract({
      address,
      abi: hotColdAbi,
      functionName: 'settleAndStartNextRound',
      args: [winner, nextState.buyInWei, digestToBytes32(this.getCommitmentDigest(nextState))],
    });

    const receipt = await client.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== 'success') {
      throw new Error('Settlement transaction failed or reverted');
    }

    this.state = nextState;
    this.processedPayments.clear();
  }

  public getState(): GameRoundState {
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

    await this.ensureRoundIsReady();

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

    const isWinner = matches === this.state.digits;

    if (isWinner) {
      this.state.winner = {
        ...guessRecord,
        payoutWei: this.state.potWei,
      };
      payout = { winner: player, amountWei: this.state.potWei.toString() };
    } else if (matches >= this.state.nearMatchThreshold && this.state.priceSteps < MAX_PRICE_STEPS) {
      const stepIncrease = (this.state.buyInWei * BigInt(PRICE_INCREASE_BPS)) / BigInt(10000);
      this.state.buyInWei += stepIncrease;
      this.state.priceSteps += 1;
    }

    this.state.guesses.unshift(guessRecord);
    const nonceKey = `${authorization.payer.toLowerCase()}:${authorization.nonce}`;
    this.processedPayments.add(nonceKey);

    if (isWinner) {
      const finishedState: GameRoundState = {
        ...this.state,
        guesses: [...this.state.guesses],
        winner: this.state.winner ? { ...this.state.winner } : undefined,
      };

      await this.settleAndOpenNextRound(authorization.payer as Address, payment.roundId);

      return { state: finishedState, guess: guessRecord, payout };
    }

    return { state: this.state, guess: guessRecord, payout };
  }

  private async resetRoundForChain(roundId: bigint) {
    const onchain = await this.readRoundFromChain(roundId);
    const startedAt = new Date().toISOString();
    const targetCommitment = this.createCommitmentFromOnchain(roundId, onchain.targetCommitment, startedAt);
    const restoredSecret = this.state?.targetSecret;
    const roundIdStr = roundId.toString();
    const matchingSecret = restoredSecret && sealTarget(roundIdStr, restoredSecret) === targetCommitment.digest ? restoredSecret : undefined;

    this.state = this.createRound({
      roundId: roundIdStr,
      buyInWei: onchain.buyIn,
      potWei: onchain.pot,
      guesses: [],
      priceSteps: 0,
      startedAt,
      winner: undefined,
      targetDigest: targetCommitment.digest,
      sealedHash: targetCommitment.digest,
      targetSecret: matchingSecret,
      targetCommitment,
    });
    void this.commitTargetDigest(this.state);
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
    if (!authorization.nonce || !authorization.deadline || !authorization.value) {
      throw new Error('Authorization is missing required fields');
    }

    const nonceKey = `${authorization.payer.toLowerCase()}:${authorization.nonce}`;
    if (this.processedPayments.has(nonceKey)) {
      throw new Error('Authorization already used for a guess');
    }

    const { client, wallet, address } = this.ensureOnchainClient();
    const currentRoundId = (await client.readContract({ address, abi: hotColdAbi, functionName: 'currentRoundId' })) as bigint;
    const roundId = authorization.roundId ? BigInt(authorization.roundId) : currentRoundId;

    const permitValue = BigInt(authorization.value);
    const txHash = await wallet.writeContract({
      address,
      abi: hotColdAbi,
      functionName: 'payForGuess',
      args: [roundId, authorization.payer, permitValue, BigInt(authorization.deadline), authorization.v, authorization.r, authorization.s],
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
    const { targetDigest, targetSecret, buyInWei, potWei, winner, guesses, targetCommitment, ...rest } = this.state;
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
      targetCommitment,
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
