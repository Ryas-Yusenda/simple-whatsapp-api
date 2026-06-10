import * as wa from '../lib/whatsapp.js';
import QRCode from 'qrcode';
import { sendApiResponse } from '../lib/response.js';

const connectDevice = async (req, res) => {
  const { token } = req.body;
  if (!token) return sendApiResponse(res, 400, 'Token needed', {});
  try {
    const first = await wa.connectDevice(token);
    if (first?.status === true) {
      return sendApiResponse(res, 200, 'Connected', { qrcode: null, connected: true });
    }
    if (first?.qrcode) {
      return sendApiResponse(res, 200, 'Scan this QR code with your WhatsApp', { qrcode: first.qrcode });
    }
    if (!wa.connections[token]) {
      return sendApiResponse(res, 200, 'Processing', { qrcode: null });
    }
    let done = false;
    const timeoutMs = 30000;
    const result = { qrcode: null, message: 'Processing' };
    const handler = async (update) => {
      if (done) return;
      if (update.connection === 'open') {
        done = true;
        try {
          wa.connections[token].ev.off('connection.update', handler);
        } catch {}
        result.qrcode = null;
        result.message = 'Connected';
        return sendApiResponse(res, 200, result.message, { qrcode: result.qrcode, connected: true });
      }
      if (update.qr) {
        try {
          const dataUrl = await QRCode.toDataURL(update.qr);
          done = true;
          try {
            wa.connections[token].ev.off('connection.update', handler);
          } catch {}
          result.qrcode = dataUrl;
          result.message = 'Scan this QR code with your WhatsApp';
          return sendApiResponse(res, 200, result.message, { qrcode: result.qrcode });
        } catch {}
      }
      if (update.connection === 'close') {
        done = true;
        try {
          wa.connections[token].ev.off('connection.update', handler);
        } catch {}
        result.qrcode = null;
        result.message = 'Disconnected';
        return sendApiResponse(res, 200, result.message, { qrcode: result.qrcode, connected: false });
      }
    };
    wa.connections[token].ev.on('connection.update', handler);
    setTimeout(async () => {
      if (done) return;
      done = true;
      try {
        wa.connections[token].ev.off('connection.update', handler);
      } catch {}
      try {
        const last = await wa.connectDevice(token);
        if (last?.status === true) {
          return sendApiResponse(res, 200, 'Connected', { qrcode: null, connected: true });
        }
        if (last?.qrcode) {
          console.log(last.qrcode);
          return sendApiResponse(res, 200, 'Scan this QR code with your WhatsApp', { qrcode: last.qrcode });
        }
        return sendApiResponse(res, 200, 'Timeout', { qrcode: null, connected: false });
      } catch {
        return sendApiResponse(res, 200, 'Timeout', { qrcode: null, connected: false });
      }
    }, timeoutMs);
  } catch (error) {
    console.log(error);
    return sendApiResponse(res, 500, 'Failed to connect device', { error });
  }
};

const disconnectDevice = async (req, res) => {
  const { token: token } = req.body;
  if (token) {
    const result = await wa.disconnectDevice(token);
    return sendApiResponse(res, 200, result?.message || 'Device disconnected', result);
  }
  return sendApiResponse(res, 400, 'Check your parameter', {});
};

const sendTextMessage = async (req, res) => {
  const { token, number, msgid, text } = req.body;
  if (token && number && text) {
    const result = await wa.sendTextMessage(token, number, msgid ?? '', text);
    return sendResponse(result, res, 'Message sent successfully');
  }
  return sendApiResponse(res, 400, 'Check your parameter', {});
};

const sendPhotoMessage = async (req, res) => {
  const { token, number, url, caption, msgid, viewonce } = req.body;
  if (token && number && url) {
    const result = await wa.sendPhoto(token, number, url, caption ?? '', viewonce ?? false, msgid ?? '');
    return sendResponse(result, res, 'Photo message sent successfully');
  }
  return sendApiResponse(res, 400, 'Check your parameter', {});
};

const sendDocumentMessage = async (req, res) => {
  const { token, number, url, caption, filename, msgid } = req.body;
  if (token && number && url) {
    console.log('RUNNING', { token, number, url, caption, filename, msgid });
    const result = await wa.sendDocument(token, number, url, caption ?? '', filename, msgid ?? '');
    return sendResponse(result, res, 'Document message sent successfully');
  }
  return sendApiResponse(res, 400, 'Check your parameter', {});
};

const sendResponse = (result, res, successMessage = 'Request completed successfully') => {
  if (result) {
    return sendApiResponse(res, 200, successMessage, result);
  }
  return sendApiResponse(res, 400, 'Check your whatsapp connection', {});
};

export { connectDevice, disconnectDevice, sendTextMessage, sendPhotoMessage, sendDocumentMessage };
