import * as wa from './whatsapp.js';
import { formatReceipt } from './helper.js';

const validateAccessToken = (req, res, next) => {
  const accessToken = process.env.X_ACCESS_TOKEN;
  const requestToken = req.get('x-access-token')?.trim();

  if (!accessToken || !requestToken) {
    return res.redirect('/');
  }

  if (accessToken !== requestToken) {
    return res.redirect('/');
  }

  next();
};

const validateDestination = async (req, res, next) => {
  const { token, number } = req.body;
  if (token && number) {
    const check = await wa.isConnected(token, formatReceipt(number));

    if (!check) {
      return res.send({
        status: false,
        message: 'The destination Number not registered in WhatsApp or your sender not connected',
      });
    }
    next();
  } else {
    res.send({ status: false, message: 'Check your parameter' });
  }
};

export { validateAccessToken, validateDestination };
