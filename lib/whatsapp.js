import fs from 'fs';
import QRCode from 'qrcode';
import makeWASocket, {
  Browsers,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  DisconnectReason,
  isJidNewsletter,
  isJidStatusBroadcast,
} from 'baileys';
import { setStatus, getDeviceByBody, ensureDeviceExists, getDevice } from '../database/index.js';
import { formatReceipt, getSavedPhoneNumber, prepareMediaMessage } from './helper.js';
import { sendApiResponse } from './response.js';
import MAIN_LOGGER from './pino.js';

const connections = {};
const qrCodeCache = {};
const pairingCodeCache = {};
const connectionIntervals = {};
const logger = MAIN_LOGGER.child({});

const connectDevice = async (token, usePairingCode = false) => {
  // Ensure the device exists in database; create it if missing.
  let deviceRows = await getDeviceByBody(token);

  if (!deviceRows || deviceRows.length === 0) {
    await ensureDeviceExists(token);
    // Re-fetch the newly created row
    deviceRows = await getDeviceByBody(token);
  }

  const { state, saveCreds } = await useMultiFileAuthState(`credentials/${token}`);
  const keyStore = makeCacheableSignalKeyStore(state.keys, logger);
  const { version, isLatest } = await fetchLatestBaileysVersion();

  const checkConnectionStatus = async (connection) => {
    try {
      if (!connection?.user?.id) return false;
      const jid = `${connection.user.id.split(':')[0]}@s.whatsapp.net`;
      await connection.fetchStatus(jid);
      return true;
    } catch {
      return false;
    }
  };

  const attemptConnection = async () => {
    try {
      if (connections[token] && (await checkConnectionStatus(connections[token]))) {
        console.log('Connection is active');
        const userId = `${connections[token].user.id.split(':')[0]}@s.whatsapp.net`;
        delete qrCodeCache[token];
        delete pairingCodeCache[token];
        if (connectionIntervals[token]) {
          clearInterval(connectionIntervals[token]);
          delete connectionIntervals[token];
        }
        return { status: true, message: 'Already connected' };
      } else {
        console.log('Connection is not active, attempting to reconnect');
      }
    } catch (error) {
      console.error('Error checking existing connection:', error);
    }

    if (connections[token]) {
      try {
        connections[token].ev.removeAllListeners();
      } catch {}
      try {
        if (connections[token].ws && connections[token].ws.readyState === 1) connections[token].ws.close();
      } catch {}
    }

    const getDeviceAll = await getDevice(token);
    const markOnline = !!(getDeviceAll && getDeviceAll[0] && getDeviceAll[0].set_available !== 0);

    const connectionOptions = {
      version,
      logger,
      fireInitQueries: false,
      printQRInTerminal: false,
      auth: { creds: state.creds, keys: keyStore },
      browser: Browsers.macOS('Safari'),
      markOnlineOnConnect: markOnline,
      generateHighQualityLinkPreview: true,
      connectTimeoutMs: 30_000,
      defaultQueryTimeoutMs: undefined,
      keepAliveIntervalMs: 20_000,
      emitOwnEvents: false,
      retryRequestDelayMs: 2000,
      qrTimeout: 60000,
      shouldIgnoreJid: (jid) => isJidNewsletter(jid) || isJidStatusBroadcast(jid),
    };

    connections[token] = makeWASocket(connectionOptions);

    if (connections[token]?.ws?.on) {
      connections[token].ws.on('CB:iq', async (frame) => {
        try {
          if (frame.attrs.type === 'error' && frame.content) {
            const errorNode = Array.isArray(frame.content) ? frame.content.find((c) => c.tag === 'error') : null;
            if (errorNode && errorNode.attrs && errorNode.attrs.code === '429') {
              console.log('Rate limit error 429 detected via IQ stanza listener.');
            }
          }
        } catch (e) {
          console.error('Error processing IQ stanza for rate limit check:', e);
        }
      });
    }

    connections[token].ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          const url = await QRCode.toDataURL(qr);
          qrCodeCache[token] = url;
        } catch {}
      }

      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = code !== DisconnectReason.loggedOut;
        if (connectionIntervals[token]) {
          clearInterval(connectionIntervals[token]);
          delete connectionIntervals[token];
        }
        if (shouldReconnect) {
          if (code === 515) {
            setTimeout(() => attemptConnection(), 500);
          } else {
            connectionIntervals[token] = setInterval(() => attemptConnection(), 10000);
          }
        } else {
          setStatus(token, 'Disconnect');
          await clearConnection(token);
        }
      } else if (connection === 'open') {
        setStatus(token, 'Connected');
        const userId = `${connections[token].user.id.split(':')[0]}@s.whatsapp.net`;
        delete qrCodeCache[token];
        delete pairingCodeCache[token];
        if (connectionIntervals[token]) {
          clearInterval(connectionIntervals[token]);
          delete connectionIntervals[token];
        }
      }
    });

    connections[token].ev.on('creds.update', saveCreds);

    if (usePairingCode && !state.creds.registered) {
      const phoneNumber = await getSavedPhoneNumber(token);
      if (phoneNumber) {
        try {
          const code = await connections[token].requestPairingCode(phoneNumber);
          pairingCodeCache[token] = code;
        } catch (error) {
          console.error('Failed to request pairing code:', error);
        }
      } else {
        console.error('No saved phone number found for pairing code generation');
      }
    }
  };

  await attemptConnection();

  try {
    if (connections[token]?.ws?.on) {
      connections[token].ws.on('CB:call', async (call) => {
        const deviceRecords = await getDevice(connections[token].user.id.split(':')[0]);
        const rejectMessage = deviceRecords[0].reject_message;
        if (rejectMessage !== null) {
          if (call.content[0].tag == 'offer') {
            const callerJid = call.content[0].attrs['call-creator'];
            const caption = rejectMessage;
            await connections[token].sendMessage(callerJid, { text: caption });
          }
        }
      });
    }

    connections[token].ev.on('call', async (calls) => {
      const device = await getDevice(connections[token].user.id.split(':')[0]);
      const { reject_call, webhook_reject_call } = device[0];
      for (const call of calls) {
        if (call.status === 'offer' && (reject_call === 1 || webhook_reject_call === 1)) {
          await connections[token].rejectCall(call.id, call.from);
        }
      }
    });
  } catch {}

  return { connections: connections[token], qrcode: qrCodeCache[token] };
};

async function restoreSession(req, res) {
  const { token: token } = req.body;
  if (token) {
    const credentialsPath = './credentials/' + token;
    if (fs.existsSync(credentialsPath)) {
      connections[token] = undefined;
      const connectionResult = await connectWaBeforeSend(token);
      return connectionResult
        ? sendApiResponse(res, 200, token + ' connection restored', {
            restored: true,
            token,
            connection: connections[token] ? true : false,
          })
        : sendApiResponse(res, 200, token + ' connection failed', {
            restored: false,
            token,
            connection: connections[token] ? true : false,
          });
    }
    return sendApiResponse(res, 400, token + ' Connection failed,please scan first', {});
  }
  return sendApiResponse(res, 400, 'Wrong Parameterss', {});
}

async function disconnectDevice(waToken) {
  try {
    if (typeof connections[waToken] === 'undefined') {
      const connectionResult = await connectWaBeforeSend(waToken);
      connectionResult && (connections[waToken].disconnect(), delete connections[waToken]);
    } else {
      connections[waToken].logout();
      delete connections[waToken];
    }
    return (
      delete qrCodeCache[waToken],
      clearInterval(connectionIntervals[waToken]),
      setStatus(waToken, 'Disconnect'),
      fs.existsSync('./credentials/' + waToken) &&
        fs.rmSync(
          './credentials/' + waToken,
          {
            recursive: true,
            force: true,
          },
          (error) => {
            if (error) {
              console.log(error);
            }
          },
        ),
      {
        status: true,
        message: 'Deleting session and credential',
      }
    );
  } catch (error) {
    return (
      console.log(error),
      {
        status: true,
        message: 'Nothing deleted',
      }
    );
  }
}

const sendTextMessage = async (waToken, recipient, messageId, message) => {
  let result;
  try {
    const jid = formatReceipt(recipient);
    if (messageId == '') {
      result = await connections[waToken].sendMessage(jid, { text: message });
    } else {
      const quotedTry1 = {
        key: { remoteJid: jid, id: messageId, fromMe: false },
        message: { conversation: '' },
      };
      result = await connections[waToken].sendMessage(jid, { text: message }, { quoted: quotedTry1 });
    }
    return result;
  } catch (error) {
    return false;
  }
};

async function sendPhoto(waToken, recipient, mediaPath, caption, viewonce, msgid) {
  const formattedRecipient = formatReceipt(recipient);
  const options = msgid
    ? {
        quoted: {
          key: { remoteJid: formattedRecipient, id: msgid, fromMe: false },
          message: { conversation: '' },
        },
      }
    : undefined;

  return await connections[waToken].sendMessage(
    formattedRecipient,
    {
      image: { url: mediaPath },
      caption: caption ?? '',
      viewOnce: viewonce ?? false,
    },
    options,
  );
}

async function sendDocument(waToken, recipient, mediaPath, caption, fileName, msgid) {
  const formattedRecipient = formatReceipt(recipient);
  const options = msgid
    ? {
        quoted: {
          key: { remoteJid: formattedRecipient, id: msgid, fromMe: false },
          message: { conversation: '' },
        },
      }
    : undefined;

  const mediaMessage = await prepareMediaMessage(connections[waToken], {
    caption: caption ?? '',
    fileName,
    media: mediaPath,
    mediatype: 'document',
  });

  if (!mediaMessage) {
    return false;
  }

  const forwardMessage = { ...mediaMessage.message };
  const userId = connections[waToken].user.id.replace(/:\d+/, '');

  return await connections[waToken].sendMessage(
    formattedRecipient,
    {
      forward: {
        key: { remoteJid: userId, fromMe: true },
        message: forwardMessage,
      },
    },
    options,
  );
}

function clearConnection(waToken) {
  clearInterval(connectionIntervals[waToken]);
  delete connections[waToken];
  delete qrCodeCache[waToken];
  delete pairingCodeCache[waToken];
  setStatus(waToken, 'Disconnect');
  fs.existsSync('./credentials/' + waToken) &&
    (fs.rmSync(
      './credentials/' + waToken,
      {
        recursive: true,
        force: true,
      },
      (error) => {
        if (error) {
          console.log(error);
        }
      },
    ),
    console.log('credentials/' + waToken + ' is deleted'));
}

async function isConnected(waToken, phoneNumber) {
  try {
    if (typeof connections[waToken] === 'undefined') {
      const connectionResult = await connectWaBeforeSend(waToken);
      if (!connectionResult) {
        return { status: false, message: 'Your whatsapp sender not connected' };
      }
    }
    if (phoneNumber.includes('@g.us')) {
      return { status: true, message: 'Group chat is valid' };
    } else if (phoneNumber.includes('@newsletter')) {
      return { status: true, message: 'Newsletter chat is valid' };
    } else {
      const [isOnWhatsApp] = await connections[waToken].onWhatsApp('+' + phoneNumber);
      return phoneNumber.length > 11
        ? {
            status: isOnWhatsApp,
            message: isOnWhatsApp ? 'Number is registered on WhatsApp' : 'Number is not registered on WhatsApp',
          }
        : { status: true, message: 'Number is valid' };
    }
  } catch (error) {
    return { status: false, message: 'An error occurred while checking connection' };
  }
}

async function connectWaBeforeSend(waToken) {
  let isConnected = undefined;
  const connectResult = await connectDevice(waToken);
  await connectResult.connections.ev.on('connection.update', (update) => {
    const { connection: connectionStatus, qr: qrCode } = update;
    connectionStatus === 'open' && (isConnected = true);
    qrCode && (isConnected = false);
  });
  let retryCount = 0;
  while (typeof isConnected === 'undefined') {
    retryCount++;
    if (retryCount > 4) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return isConnected;
}

export {
  connections,
  connectDevice,
  restoreSession,
  disconnectDevice,
  sendTextMessage,
  sendPhoto,
  sendDocument,
  isConnected,
  connectWaBeforeSend,
};
