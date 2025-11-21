import { useEffect, useState } from 'react';
import { PrivyProvider, usePrivy } from '@privy-io/react-auth';
import { baseSepolia } from 'viem/chains';
import './App.css';
import { HOT_COLD_GAME_ADDRESS, PRIVY_APP_ID } from './config/constants';
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
  buyInEth: string;
  potEth: string;
  priceSteps: number;
  nearMatchThreshold: number;
  priceIncreaseBps: number;
  distanceMetric: string;
  startedAt: string;
  winner?: Guess & { payoutWei: string };
  guesses: Guess[];
}

function GameScreen() {
  const { ready, authenticated, user } = usePrivy();
  const [round, setRound] = useState<RoundState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guessValue, setGuessValue] = useState('');
  const [paymentTxHash, setPaymentTxHash] = useState('');

  useEffect(() => {
    refreshState();
  }, []);

  async function refreshState() {
    try {
      const response = await fetchGameState();
      setRound(response.round);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load game');
    }
  }

  async function handleGuess(e: React.FormEvent) {
    e.preventDefault();
    if (!round) return;

    try {
      setLoading(true);
      setError(null);
      const result = await submitGuess({
        guess: guessValue,
        player: user?.wallet?.address || 'anonymous',
        paymentTxHash,
      });
      setRound(result.round);
      setGuessValue('');
      setPaymentTxHash('');
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
            <span className="label">Round</span>
            <strong>{round?.roundId.slice(0, 8) || '—'}</strong>
          </div>
          <div>
            <span className="label">Digits</span>
            <strong>{round?.digits ?? '—'}</strong>
          </div>
          <div>
            <span className="label">Metric</span>
            <strong>{round?.distanceMetric ?? '—'}</strong>
          </div>
        </div>
      </div>

      <div className="grid">
        <div className="panel stat">
          <span className="label">Current buy-in</span>
          <h2>{round?.buyInEth ? `${round.buyInEth} ETH` : '—'}</h2>
          <p className="muted">Auto-steps {round?.priceIncreaseBps}% when matches ≥ {round?.nearMatchThreshold}</p>
        </div>
        <div className="panel stat">
          <span className="label">Pot</span>
          <h2>{round?.potEth ? `${round.potEth} ETH` : '—'}</h2>
          <p className="muted">Raised by every paid guess</p>
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
          <label>
            Payment transaction hash
            <input
              required
              value={paymentTxHash}
              onChange={(e) => setPaymentTxHash(e.target.value)}
              placeholder="0x..."
              pattern="0x[0-9a-fA-F]{64}"
            />
          </label>
          <button type="submit" disabled={loading || !ready || !authenticated}>
            {loading ? 'Submitting...' : 'Send guess'}
          </button>
        </form>
        {!ready && <p className="muted">Waiting for Privy to initialize…</p>}
        {!authenticated && ready && <p className="muted">Login with Privy to attach your wallet to guesses.</p>}
        <p className="muted">
          Pay the current buy-in to the HotColdGame contract
          {HOT_COLD_GAME_ADDRESS ? ` (${HOT_COLD_GAME_ADDRESS})` : ''} using <code>payForGuess(roundId)</code>, then paste the
          transaction hash above to reveal your deterministic hint.
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
                  <span className="muted">stake {g.stakeEth}</span>
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
            {round.winner.player} matched the target with {round.winner.guess} and takes the pot ({round.winner.stakeEth}
            ETH).
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
