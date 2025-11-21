import { TEE_SERVER_URL } from '../config/constants';

async function apiRequest(endpoint: string, options: RequestInit = {}) {
  const url = `${TEE_SERVER_URL}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

export function fetchGameState() {
  return apiRequest('/game');
}

export function submitGuess(payload: { guess: string; player: string; paymentTxHash: string }) {
  return apiRequest('/game/guess', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function resetRound() {
  return apiRequest('/game/reset', { method: 'POST' });
}
