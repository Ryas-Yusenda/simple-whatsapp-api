import express from 'express';
import rateLimit from 'express-rate-limit';
import * as controllers from '../controllers/index.js';
import { restoreSession } from '../lib/whatsapp.js';
import { validateAccessToken, validateDestination } from '../lib/middleware.js';
import { sendApiResponse } from '../lib/response.js';

const router = express.Router();

const createLimiter = (windowMs) =>
  rateLimit({
    windowMs,
    max: 1,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: 'Too many requests, please try again later.',
    },
  });

const oneSecondLimiter = createLimiter(1000);
const fiveSecondLimiter = createLimiter(5000);
const eightSecondLimiter = createLimiter(8000);

router.get('/', (req, res) => {
  sendApiResponse(res, 200, 'Server is running', {
    timestamp: new Date().toISOString(),
  });
});

router.post('/api/v1/devices/connect', fiveSecondLimiter, validateAccessToken, controllers.connectDevice);
router.post('/api/v1/devices/restore', fiveSecondLimiter, validateAccessToken, restoreSession);
router.post('/api/v1/devices/disconnect', fiveSecondLimiter, validateAccessToken, controllers.disconnectDevice);
router.post(
  '/api/v1/messages/text',
  oneSecondLimiter,
  validateAccessToken,
  validateDestination,
  controllers.sendTextMessage,
);
router.post(
  '/api/v1/messages/photo',
  fiveSecondLimiter,
  validateAccessToken,
  validateDestination,
  controllers.sendPhotoMessage,
);
router.post(
  '/api/v1/messages/document',
  eightSecondLimiter,
  validateAccessToken,
  validateDestination,
  controllers.sendDocumentMessage,
);

export default router;
