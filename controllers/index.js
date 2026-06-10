import * as wa from '../lib/whatsapp.js';
import QRCode from 'qrcode';

const connectDevice = async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(403).end('Token needed');
  try {
    const first = await wa.connectDevice(token);
    if (first?.status === true) {
      return res.send({ status: true, qrcode: null, message: 'Connected' });
    }
    if (first?.qrcode) {
      return res.send({
        status: 'qrcode',
        qrcode: first.qrcode,
        message: 'Scan this QR code with your WhatsApp',
      });
    }
    if (!wa.connections[token]) {
      return res.send({ status: 'processing', qrcode: null, message: 'Processing' });
    }
    let done = false;
    const timeoutMs = 30000;
    const result = { status: 'processing', qrcode: null, message: 'Processing' };
    const handler = async (update) => {
      if (done) return;
      if (update.connection === 'open') {
        done = true;
        try {
          wa.connections[token].ev.off('connection.update', handler);
        } catch {}
        result.status = true;
        result.qrcode = null;
        result.message = 'Connected';
        return res.send(result);
      }
      if (update.qr) {
        try {
          const dataUrl = await QRCode.toDataURL(update.qr);
          done = true;
          try {
            wa.connections[token].ev.off('connection.update', handler);
          } catch {}
          result.status = 'qrcode';
          result.qrcode = dataUrl;
          result.message = 'Scan this QR code with your WhatsApp';
          return res.send(result);
        } catch {}
      }
      if (update.connection === 'close') {
        done = true;
        try {
          wa.connections[token].ev.off('connection.update', handler);
        } catch {}
        result.status = false;
        result.qrcode = null;
        result.message = 'Disconnected';
        return res.send(result);
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
          return res.send({ status: true, qrcode: null, message: 'Connected' });
        }
        if (last?.qrcode) {
          console.log(last.qrcode);
          return res.send({
            status: 'qrcode',
            qrcode: last.qrcode,
            message: 'Scan this QR code with your WhatsApp',
          });
        }
        return res.send({ status: false, qrcode: null, message: 'Timeout' });
      } catch {
        return res.send({ status: false, qrcode: null, message: 'Timeout' });
      }
    }, timeoutMs);
  } catch (error) {
    console.log(error);
    return res.send({ status: false, error });
  }
};

const disconnectDevice = async (req, res) => {
  const { token: token } = req.body;
  if (token) {
    const result = await wa.disconnectDevice(token);
    return res.send(result);
  }
  return res.send({
    status: false,
    message: 'Check your parameter',
  });
};

const sendTextMessage = async (req, res) => {
  const { token, number, msgid, text } = req.body;
  if (token && number && text) {
    const result = await wa.sendTextMessage(token, number, msgid ?? '', text);
    return sendResponse(result, res);
  }
  return res.send({
    status: false,
    message: 'Check your parameter',
  });
};

const sendPhotoMessage = async (req, res) => {
  const { token, number, url, caption, msgid, viewonce } = req.body;
  if (token && number && url) {
    const result = await wa.sendPhoto(token, number, url, caption ?? '', viewonce ?? false, msgid ?? '');
    return sendResponse(result, res);
  }
  return res.send({
    status: false,
    message: 'Check your parameter',
  });
};

const sendDocumentMessage = async (req, res) => {
  const { token, number, url, caption, filename, msgid } = req.body;
  if (token && number && url) {
    console.log('RUNNING', { token, number, url, caption, filename, msgid });
    const result = await wa.sendDocument(token, number, url, caption ?? '', filename, msgid ?? '');
    return sendResponse(result, res);
  }
  return res.send({
    status: false,
    message: 'Check your parameter',
  });
};

const sendResponse = (result, res, extraParam = null) => {
  if (result) {
    return res.send({
      status: true,
      data: result,
    });
  }
  return res.send({
    status: false,
    message: 'Check your whatsapp connection',
  });
};

export { connectDevice, disconnectDevice, sendTextMessage, sendPhotoMessage, sendDocumentMessage };
