import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import routes from './routes';
import { SERVER_PORT } from './config/constants';

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());
app.use('/', routes);

app.get('/', (_req, res) => {
  res.json({
    success: true,
    message: 'Hot-Cold enclave lottery API',
    endpoints: {
      state: 'GET /game',
      guess: 'POST /game/guess { guess, player, stake }',
      reset: 'POST /game/reset',
    },
  });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

app.use('*', (req, res) => {
  res.status(404).json({ success: false, error: 'Endpoint not found', path: req.originalUrl });
});

app.listen(SERVER_PORT, () => {
  console.log(`🎯 Hot-Cold enclave server on ${SERVER_PORT}`);
});
