import { useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { formatEther, createPublicClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';
import { RPC_URL } from '../config/constants';

export function ConnectionStatus() {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const [balance, setBalance] = useState<string>('');

  useEffect(() => {
    async function loadBalance() {
      if (!authenticated || !user?.wallet?.address || !RPC_URL) return;
      try {
        const client = createPublicClient({ chain: baseSepolia, transport: http(RPC_URL) });
        const wei = await client.getBalance({ address: user.wallet.address as `0x${string}` });
        setBalance(parseFloat(formatEther(wei)).toFixed(4));
      } catch (err) {
        console.error('Failed to fetch balance', err);
      }
    }

    loadBalance();
  }, [authenticated, user?.wallet?.address]);

  return (
    <div className="panel connection">
      <div>
        <p className="eyebrow">Privy</p>
        <h3>{authenticated ? 'Connected' : 'Connect to start guessing'}</h3>
        <p className="muted">Use Privy to attach your wallet to each guess and payout.</p>
      </div>
      <div className="connection-actions">
        {authenticated ? (
          <>
            <div className="wallet-line">
              <span className="label">Wallet</span>
              <strong>{user?.wallet?.address?.slice(0, 10)}…</strong>
            </div>
            {balance && (
              <div className="wallet-line">
                <span className="label">Balance</span>
                <strong>{balance} ETH</strong>
              </div>
            )}
            <button className="ghost" onClick={logout} disabled={!ready}>
              Disconnect
            </button>
          </>
        ) : (
          <button onClick={login} disabled={!ready}>
            {ready ? 'Login with Privy' : 'Loading Privy…'}
          </button>
        )}
      </div>
    </div>
  );
}
