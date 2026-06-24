import * as wa from '../lib/whatsapp.js';
import QRCode from 'qrcode';
import { sendApiResponse } from '../lib/response.js';

import mime from 'mime-types';

async function connectDevice(req, res) {
  const token = process.env.SENDER_NUMBER;
  if (!token) return sendApiResponse(res, 400, 'SENDER_NUMBER not configured', { qrcode: null, connected: false });
  try {
    const first = await wa.connectDevice();
    let done = false;

    if (first?.status === true) {
      return sendApiResponse(res, 200, 'Your device is already connected', {
        qrcode: null,
        connected: true,
      });
    }

    if (first?.qrcode) {
      return sendApiResponse(res, 200, 'Scan this QR code with your WhatsApp(1)', {
        qrcode: first.qrcode,
        connected: false,
      });
    }

    if (!wa.getConnection()) {
      return sendApiResponse(res, 200, 'Failed to connect device(1)', {
        qrcode: null,
        connected: false,
      });
    }

    async function handler(update) {
      if (done) return;
      if (update.connection === 'open') {
        done = true;
        try {
          wa.getConnection().ev.off('connection.update', handler);
        } catch {}
        return sendApiResponse(res, 200, 'Connected', {
          qrcode: null,
          connected: true,
        });
      }
      if (update.qr) {
        try {
          const dataUrl = await QRCode.toDataURL(update.qr);
          done = true;
          try {
            wa.getConnection().ev.off('connection.update', handler);
          } catch {}
          return sendApiResponse(res, 200, 'Scan this QR code with your WhatsApp(2)', {
            qrcode: dataUrl,
            connected: false,
          });
        } catch {}
      }
      if (update.connection === 'close') {
        done = true;
        try {
          wa.getConnection().ev.off('connection.update', handler);
        } catch {}
        return sendApiResponse(res, 200, 'Disconnected', {
          qrcode: null,
          connected: false,
        });
      }
    }

    wa.getConnection().ev.on('connection.update', handler);

    setTimeout(() => {
      if (done) return;

      done = true;

      try {
        wa.getConnection().ev.off('connection.update', handler);
      } catch {}

      return sendApiResponse(res, 408, 'Connection timeout', {
        qrcode: null,
        connected: false,
      });
    }, 60000);
  } catch (error) {
    return sendApiResponse(res, 500, 'Failed to connect device(2)', {
      qrcode: null,
      connected: false,
      error: error.message || error.toString(),
    });
  }
}

async function disconnectDevice(req, res) {
  const token = process.env.SENDER_NUMBER;
  if (token) {
    const result = await wa.disconnectDevice();
    return sendApiResponse(res, 200, result?.message || 'Device disconnected', {
      success: result?.status === true,
      token,
    });
  }
  return sendApiResponse(res, 400, 'Check your parameter', {});
}

async function sendTextMessage(req, res) {
  const token = process.env.SENDER_NUMBER;
  const { number, msgid, text } = req.body;
  if (token && number && text) {
    const result = await wa.sendTextMessage(number, msgid ?? '', text);
    if (result) {
      return sendApiResponse(res, 200, 'Message sent successfully', result);
    }

    return sendApiResponse(res, 400, 'Failed to send message', {});
  }
  return sendApiResponse(res, 400, 'Check your parameter', {});
}

async function sendPhotoMessage(req, res) {
  const token = process.env.SENDER_NUMBER;
  const { number, url, caption, msgid, viewonce } = req.body;

  if (!token || !number || !url) {
    return sendApiResponse(res, 400, 'Check your parameter', {});
  }

  try {
    // detect mime first (fast check)
    const resHead = await fetch(url, { redirect: 'follow' });
    let mimeType = resHead.headers.get('content-type') || '';

    // fallback from extension
    const extMime = mime.lookup(url) || '';

    mimeType = (mimeType || extMime).toLowerCase();

    // strict whitelist
    const allowed = ['image/jpeg', 'image/jpg', 'image/png'];

    const isAllowed = allowed.includes(mimeType) || url.match(/\.(jpg|jpeg|png)$/i);

    if (!isAllowed) {
      return sendApiResponse(res, 400, 'Only JPG, JPEG, PNG allowed', {
        detected: mimeType,
      });
    }

    const result = await wa.sendPhoto(number, url, caption ?? '', viewonce ?? false, msgid ?? '');

    if (result) {
      return sendApiResponse(res, 200, 'Photo message sent successfully', result);
    }

    return sendApiResponse(res, 400, 'Failed to send photo message', {});
  } catch (err) {
    return sendApiResponse(res, 500, 'Error processing image', {
      error: err.message,
    });
  }
}

async function sendDocumentMessage(req, res) {
  const token = process.env.SENDER_NUMBER;
  const { number, url, caption, filename, msgid } = req.body;
  if (token && number && url) {
    const result = await wa.sendDocument(number, url, caption ?? '', filename, msgid ?? '');
    if (result) {
      return sendApiResponse(res, 200, 'Document message sent successfully', result);
    }

    return sendApiResponse(res, 400, 'Failed to send document message', {});
  }
  return sendApiResponse(res, 400, 'Check your parameter', {});
}

export { connectDevice, disconnectDevice, sendTextMessage, sendPhotoMessage, sendDocumentMessage };
