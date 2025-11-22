import { useEffect, useState } from 'react';
import { PrivyProvider, usePrivy, useWallets } from '@privy-io/react-auth';
import { Address, Hex, createPublicClient, createWalletClient, custom, http } from 'viem';
import { baseSepolia } from 'viem/chains';
import './App.css';
import {
  CHAIN_ID,
  HOT_COLD_GAME_ADDRESS,
  PAYMENT_TOKEN_ADDRESS,
  PAYMENT_TOKEN_NAME,
  PAYMENT_TOKEN_SYMBOL,
  PAYMENT_TOKEN_VERSION,
  PRIVY_APP_ID,
  RPC_URL,
} from './config/constants';
import { ConnectionStatus } from './components/ConnectionStatus';
import { fetchGameState, resetRound, submitGuess } from './services/api';

interface Guess {
  player: string;
  guess: string;
  stakeEth: string;
  hint: string;
  createdAt: string;
  matches: number;
  distance: number;
  priceStepAtGuess: number;
}

interface RoundState {
  roundId: string;
  digits: number;
  sealedTargetHash: string;
  buyInWei: string;
  buyInEth: string;
  potEth: string;
  priceSteps: number;
  nearMatchThreshold: number;
  priceIncreaseBps: number;
  distanceMetric: string;
  startedAt: string;
  paymentTokenSymbol: string;
  paymentTokenAddress: string;
  winner?: Guess & { payoutWei: string };
  guesses: Guess[];
}

const permitAbi = [
  {
    type: 'function',
    name: 'nonces',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: 'nonce', type: 'uint256' }],
  },
] as const;

function splitSignature(signature: Hex): { v: number; r: Hex; s: Hex } {
  const raw = signature.slice(2);
  const r = (`0x${raw.slice(0, 64)}`) as Hex;
  const s = (`0x${raw.slice(64, 128)}`) as Hex;
  const v = Number.parseInt(raw.slice(128, 130), 16);
  return { v, r, s };
}

function GameScreen() {
  const { ready, authenticated, user } = usePrivy();
  const { wallets } = useWallets();
  const [round, setRound] = useState<RoundState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guessValue, setGuessValue] = useState('');

  useEffect(() => {
    refreshState();
  }, []);

  const playerAddress = user?.wallet?.address || wallets?.[0]?.address || 'anonymous';

  async function refreshState() {
    try {
      const response = await fetchGameState();
      setRound(response.round);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load game');
    }
  }

  async function buildAuthorization(): Promise<{
    roundId: string;
    payer: Address;
    value: string;
    deadline: string;
    nonce: string;
    v: number;
    r: Hex;
    s: Hex;
  }> {
    if (!round) {
      throw new Error('Round not loaded');
    }
    if (!HOT_COLD_GAME_ADDRESS || !PAYMENT_TOKEN_ADDRESS) {
      throw new Error('Game and token addresses must be configured');
    }

    const wallet = wallets?.[0];
    if (!wallet) {
      throw new Error('Connect a wallet with Privy to sign payments');
    }
    if (!RPC_URL) {
      throw new Error('RPC_URL must be configured to read permit nonces');
    }

    const provider = await wallet.getEthereumProvider();
    const client = createWalletClient({
      account: wallet.address as Address,
      chain: baseSepolia,
      transport: custom(provider),
    });
    const readClient = createPublicClient({ chain: baseSepolia, transport: http(RPC_URL) });

    const nonce = (await readClient.readContract({
      address: PAYMENT_TOKEN_ADDRESS as Address,
      abi: permitAbi,
      functionName: 'nonces',
      args: [wallet.address as Address],
    })) as bigint;

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 15 * 60); // 15 minutes

    const signature = await client.signTypedData({
      account: wallet.address as Address,
      domain: {
        name: PAYMENT_TOKEN_NAME,
        version: PAYMENT_TOKEN_VERSION,
        chainId: BigInt(CHAIN_ID),
        verifyingContract: PAYMENT_TOKEN_ADDRESS as Address,
      },
      types: {
        Permit: [
          { name: 'owner', type: 'address' },
          { name: 'spender', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
      primaryType: 'Permit',
      message: {
        owner: wallet.address as Address,
        spender: HOT_COLD_GAME_ADDRESS as Address,
        value: BigInt(round.buyInWei),
        nonce,
        deadline,
      },
    });

    const { v, r, s } = splitSignature(signature as Hex);

    return {
      roundId: round.roundId,
      payer: wallet.address as Address,
      value: round.buyInWei,
      deadline: deadline.toString(),
      nonce: nonce.toString(),
      v,
      r,
      s,
    };
  }

  async function handleGuess(e: React.FormEvent) {
    e.preventDefault();
    if (!round) return;

    try {
      setLoading(true);
      setError(null);
      if (!authenticated || !wallets?.length) {
        throw new Error('Login with Privy and connect a wallet to submit a paid guess');
      }
      if (!playerAddress || playerAddress === 'anonymous') {
        throw new Error('Wallet address required to sign payment authorization');
      }
      const authorization = await buildAuthorization();
      const result = await submitGuess({
        guess: guessValue,
        player: playerAddress,
        authorization,
      });
      setRound(result.round);
      setGuessValue('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit guess');
    } finally {
      setLoading(false);
    }
  }

  async function handleReset() {
    try {
      setLoading(true);
      setError(null);
      const response = await resetRound();
      setRound(response.round);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset round');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="game-shell">
      <div className="panel header-panel">
        <div>
          <p className="eyebrow">TEE-sealed hot/cold lottery</p>
          <h1>Guess the enclave number</h1>
          <p>
            A verifiable enclave sealed a target number and returns deterministic hints after each guess.
            Buy-ins rise automatically when guesses get close; the first exact match takes the pot.
          </p>
        </div>
        <div className="round-meta">
          <div>
            <span className="label">Round: </span>
            <strong>{round?.roundId.slice(0, 8) || '—'}</strong>
          </div>
          <div>
            <span className="label">Digits: </span>
            <strong>{round?.digits ?? '—'}</strong>
          </div>
          <div>
            <span className="label">Metric: </span>
            <strong>{round?.distanceMetric ?? '—'}</strong>
          </div>
        </div>
      </div>

      <div className="grid">
        <div className="panel stat">
          <span className="label">Current buy-in</span>
          <h2>{round?.buyInEth ? `${round.buyInEth} ${round?.paymentTokenSymbol || 'TOKEN'}` : '—'}</h2>
          <p className="muted">Auto-steps {round?.priceIncreaseBps}% when matches ≥ {round?.nearMatchThreshold}</p>
        </div>
        <div className="panel stat">
          <span className="label">Pot</span>
          <h2>{round?.potEth ? `${round.potEth} ${round?.paymentTokenSymbol || 'TOKEN'}` : '—'}</h2>
          <p className="muted">Raised by every signed, on-chain paid guess</p>
        </div>
        <div className="panel stat">
          <span className="label">Sealed target hash</span>
          <code className="hash">{round?.sealedTargetHash || '—'}</code>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <div>
            <h3>Submit guess</h3>
            <p className="muted">Pay the buy-in with your guess; the enclave returns a deterministic hint.</p>
          </div>
          <button className="ghost" onClick={handleReset} disabled={loading}>
            Reset round
          </button>
        </div>
        <form className="guess-form" onSubmit={handleGuess}>
          <label>
            Guess ({round?.digits || 0} digits)
            <input
              required
              value={guessValue}
              onChange={(e) => setGuessValue(e.target.value)}
              placeholder="0000..."
              pattern={`\\d{${round?.digits || 1}}`}
            />
          </label>
          <button type="submit" disabled={loading || !ready || !authenticated}>
            {loading ? 'Submitting...' : 'Send guess'}
          </button>
        </form>
        {!ready && <p className="muted">Waiting for Privy to initialize…</p>}
        {!authenticated && ready && <p className="muted">Login with Privy to attach your wallet to guesses.</p>}
        <p className="muted">
          You will sign an ERC-2612 permit to move {round?.buyInEth || '—'} {round?.paymentTokenSymbol || ''} to the game
          contract {HOT_COLD_GAME_ADDRESS || ''}; the enclave backend pays gas, verifies on-chain success, then returns your
          deterministic hint.
        </p>
        <p className="muted">
          Payment token: {round?.paymentTokenSymbol || PAYMENT_TOKEN_SYMBOL} at {round?.paymentTokenAddress || PAYMENT_TOKEN_ADDRESS}
        </p>
        {error && <p className="error">{error}</p>}
      </div>

      <div className="panel">
        <div className="panel-header">
          <h3>Guess stream</h3>
          <p className="muted">Newest guesses first with deterministic hot/cold hints.</p>
        </div>
        {round?.guesses?.length ? (
          <div className="guess-list">
            {round.guesses.map((g) => (
              <div key={`${g.player}-${g.createdAt}`} className="guess-row">
                <div>
                  <p className="eyebrow">{g.player.slice(0, 8)}…</p>
                  <strong>{g.guess}</strong>
                </div>
                <div className="hint">
                  <span>{g.hint}</span>
                  <span className="muted">
                    stake {g.stakeEth} {round?.paymentTokenSymbol || PAYMENT_TOKEN_SYMBOL}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">No guesses yet—be the first.</p>
        )}
      </div>

      {round?.winner && (
        <div className="panel winner">
          <h3>Winner sealed</h3>
          <p>
            {round.winner.player} matched the target with {round.winner.guess} and takes the pot ({round.winner.stakeEth}{' '}
            {round.paymentTokenSymbol || PAYMENT_TOKEN_SYMBOL}).
          </p>
        </div>
      )}
    </div>
  );
}

function App() {
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ['wallet', 'email'],
        defaultChain: baseSepolia,
        embeddedWallets: { createOnLogin: 'users-without-wallets' },
      }}
    >
      <div className="app">
        <ConnectionStatus />
        <GameScreen />
      </div>
    </PrivyProvider>
  );
}

export default App;
