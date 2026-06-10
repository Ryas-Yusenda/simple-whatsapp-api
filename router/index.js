import express from 'express';
import * as controllers from '../controllers/index.js';
import { restoreSession } from '../lib/whatsapp.js';
import { validateAccessToken, validateDestination } from '../lib/middleware.js';

const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    message: 'Server is running',
    timestamp: new Date().toISOString(),
  });
});

router.post('/api/v1/devices/connect', validateAccessToken, controllers.connectDevice);
router.post('/api/v1/devices/restore', validateAccessToken, restoreSession);
router.post('/api/v1/devices/disconnect', validateAccessToken, controllers.disconnectDevice);
router.post('/api/v1/messages/text', validateAccessToken, validateDestination, controllers.sendTextMessage);
router.post('/api/v1/messages/photo', validateAccessToken, validateDestination, controllers.sendPhotoMessage);
router.post('/api/v1/messages/document', validateAccessToken, validateDestination, controllers.sendDocumentMessage);

export default router;
