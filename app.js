import http from 'http';
import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';

import router from './router/index.js';
import { sendApiResponse } from './lib/response.js';

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT_NODE;

app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

app.use(
  bodyParser.urlencoded({
    extended: false,
    limit: '50mb',
    parameterLimit: 100000,
  }),
);
app.use(bodyParser.json());

app.use(router);

app.use((req, res) => {
  sendApiResponse(res, 200, 'Server is running', {});
});

(async () => {
  server.listen(PORT, () => {
    console.log(`Server running and listening on port: ${PORT}`);
  });
})();
