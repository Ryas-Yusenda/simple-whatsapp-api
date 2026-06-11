import * as wa from './whatsapp.js';
import { formatReceipt } from './helper.js';
import { sendApiResponse } from './response.js';

const validateAccessToken = (req, res, next) => {
  const accessToken = process.env.X_ACCESS_TOKEN;
  const requestToken = req.get('x-access-token')?.trim();

  if (!accessToken || !requestToken) {
    return sendApiResponse(res, 401, 'Unauthorized access token missing', {});
  }

  if (accessToken !== requestToken) {
    return sendApiResponse(res, 403, 'Invalid access token', {});
  }

  next();
};

const validateDestination = async (req, res, next) => {
  const { token, number } = req.body;
  if (token && number) {
    const check = await wa.isConnected(token, formatReceipt(number));

    if (check?.status === false) {
      return sendApiResponse(res, 400, check?.message || 'WhatsApp connection issue', {});
    }

    next();
  } else {
    return sendApiResponse(res, 400, 'Check your parameter', {});
  }
};

export { validateAccessToken, validateDestination };
