import http from 'http';
import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';

import { getConnectedDevices } from './database/index.js';
import router from './router/index.js';
import * as wa from './lib/whatsapp.js';

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT_NODE;

app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');

  next();
});

app.use([
  bodyParser.urlencoded({
    extended: false,
    limit: '50mb',
    parameterLimit: 100000,
  }),
  bodyParser.json(),
]);

app.use((req, res) => {
  res.redirect('/');
});

app.use(router);

(async () => {
  server.listen(PORT, () => {
    console.log(`Server running and listening on port: ${PORT}`);
  });

  try {
    const connectedDevices = await getConnectedDevices();
    connectedDevices.forEach((deviceRow) => {
      const deviceBody = deviceRow.body;
      if (/^\d+$/.test(deviceBody)) {
        wa.connectDevice(deviceBody);
      }
    });
  } catch (error) {
    console.error('Failed to load connected devices:', error);
  }
})();
