/**
 * @file components/StatsDashboard.tsx
 * @description Component displaying escrow contract statistics
 * 
 * This component shows:
 * - Total deposits since TEE server started
 * - Total withdrawals since TEE server started
 * - Total transfers since TEE server started
 * 
 * Why this component exists:
 * - Provides real-time visibility into contract activity
 * - Helps users understand escrow volume and usage
 * - Updates automatically via polling
 */

import { useEffect, useState } from 'react';
import { getDeposits, getWithdrawals, getTransfers } from '../services/api';

interface Stats {
  deposits: { totalDeposits: string; totalDepositsEth: string } | null;
  withdrawals: { totalWithdrawals: string; totalWithdrawalsEth: string } | null;
  transfers: { totalTransfers: string; totalTransfersEth: string } | null;
}

/**
 * Truncate a numeric string to a fixed number of decimal places without rounding.
 * Why: Prevent extremely long decimal values from overflowing the UI.
 */
function truncateDecimals(value: string, decimalPlaces = 5): string {
  const [integerPart, fractionalPart] = value.split('.');

  if (!fractionalPart || fractionalPart.length <= decimalPlaces) {
    return value;
  }

  return `${integerPart}.${fractionalPart.slice(0, decimalPlaces)}`;
}

interface StatsDashboardProps {
  className?: string;
  refreshInterval?: number; // in milliseconds
}

export function StatsDashboard({ 
  className = '', 
  refreshInterval = 5000 // Default: refresh every 5 seconds
}: StatsDashboardProps) {
  const [stats, setStats] = useState<Stats>({
    deposits: null,
    withdrawals: null,
    transfers: null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch statistics from TEE server
  // Why: We need to poll the server regularly to get updated statistics.
  // The server maintains these counters in-memory, so we fetch them periodically.
  async function fetchStats() {
    try {
      setLoading(true);
      setError(null);

      // Fetch all statistics in parallel
      // Why: These endpoints don't depend on each other, so we can fetch
      // them simultaneously for better performance.
      const [deposits, withdrawals, transfers] = await Promise.all([
        getDeposits(),
        getWithdrawals(),
        getTransfers(),
      ]);

      setStats({ deposits, withdrawals, transfers });
    } catch (err) {
      console.error('Failed to fetch stats:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch statistics');
    } finally {
      setLoading(false);
    }
  }

  // Fetch stats on mount and set up polling
  // Why: We want to fetch stats immediately when the component loads, and then
  // periodically refresh them to show real-time updates.
  useEffect(() => {
    fetchStats();

    // Set up interval to refresh stats
    // Why: Statistics change as events occur on the blockchain. We poll the
    // server regularly to keep the display up-to-date.
    const interval = setInterval(fetchStats, refreshInterval);

    // Cleanup interval on unmount
    // Why: Prevent memory leaks by clearing the interval when the component
    // is removed from the DOM.
    return () => clearInterval(interval);
  }, [refreshInterval]);

  if (loading && !stats.deposits) {
    return (
      <div className={`stats-dashboard ${className}`}>
        <h2>Contract Statistics</h2>
        <p>Loading statistics...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`stats-dashboard ${className}`}>
        <h2>Contract Statistics</h2>
        <p className="error">Error: {error}</p>
        <button onClick={fetchStats}>Retry</button>
      </div>
    );
  }

  return (
    <div className={`stats-dashboard ${className}`}>
      <h2>Contract Statistics</h2>
      <p className="subtitle">Activity since TEE server started</p>
      
      <div className="stats-grid">
        <div className="stat-card">
          <h3>Deposits</h3>
          <div className="stat-value">
            {stats.deposits ? (
              <>
                <div className="stat-eth">{truncateDecimals(stats.deposits.totalDepositsEth)} ETH</div>
                <div className="stat-wei">{stats.deposits.totalDeposits} wei</div>
              </>
            ) : (
              <div>Loading...</div>
            )}
          </div>
        </div>

        <div className="stat-card">
          <h3>Withdrawals</h3>
          <div className="stat-value">
            {stats.withdrawals ? (
              <>
                <div className="stat-eth">
                  {truncateDecimals(stats.withdrawals.totalWithdrawalsEth)} ETH
                </div>
                <div className="stat-wei">{stats.withdrawals.totalWithdrawals} wei</div>
              </>
            ) : (
              <div>Loading...</div>
            )}
          </div>
        </div>

        <div className="stat-card">
          <h3>Transfers</h3>
          <div className="stat-value">
            {stats.transfers ? (
              <>
                <div className="stat-eth">{truncateDecimals(stats.transfers.totalTransfersEth)} ETH</div>
                <div className="stat-wei">{stats.transfers.totalTransfers} wei</div>
              </>
            ) : (
              <div>Loading...</div>
            )}
          </div>
        </div>
      </div>

      <button 
        className="refresh-button" 
        onClick={fetchStats}
        disabled={loading}
      >
        {loading ? 'Refreshing...' : 'Refresh Stats'}
      </button>
    </div>
  );
}

