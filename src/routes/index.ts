import { Router } from 'express';
import { gameService, formatWei } from '../services/GameService';

const router = Router();

router.get('/game', (req, res) => {
  res.json({
    success: true,
    round: gameService.getPublicState(),
  });
});

router.post('/game/guess', async (req, res) => {
  const { guess, player, authorization } = req.body as {
    guess?: string;
    player?: string;
    authorization?: unknown;
  };

  if (!guess || !player || !authorization) {
    return res
      .status(400)
      .json({ success: false, error: 'guess, player, and authorization are required to record a guess' });
  }

  try {
    const result = await gameService.submitGuess({ guess, player, authorization: authorization as any });
    res.json({
      success: true,
      round: gameService.getPublicState(),
      guess: {
        ...result.guess,
        stakeWei: result.guess.stakeWei.toString(),
        stakeEth: formatWei(result.guess.stakeWei),
      },
      payout: result.payout,
    });
  } catch (error) {
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

router.post('/game/reset', (_req, res) => {
  const round = gameService.resetRound();
  res.json({ success: true, round: gameService.getPublicState(), sealedTargetHash: round.sealedHash });
});

export default router;
