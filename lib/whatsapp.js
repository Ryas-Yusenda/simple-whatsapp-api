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
import { formatReceipt, getSavedPhoneNumber, prepareMediaMessage } from './helper.js';
import { sendApiResponse } from './response.js';
import MAIN_LOGGER from './pino.js';

const connections = {};
const qrCodeCache = {};
const pairingCodeCache = {};
const connectionIntervals = {};
const logger = MAIN_LOGGER.child({});

const isConnectionActive = async (connection) => {
  try {
    if (!connection?.user?.id) return false;
    const jid = `${connection.user.id.split(':')[0]}@s.whatsapp.net`;
    await connection.fetchStatus(jid);
    return true;
  } catch {
    return false;
  }
};

const connectDevice = async (waToken, usePairingCode = false) => {
  const { state, saveCreds } = await useMultiFileAuthState(`credentials/${waToken}`);
  const keyStore = makeCacheableSignalKeyStore(state.keys, logger);
  const { version, isLatest } = await fetchLatestBaileysVersion();

  const attemptConnection = async () => {
    try {
      if (connections[waToken] && (await isConnectionActive(connections[waToken]))) {
        console.log('Connection is active');
        const userId = `${connections[waToken].user.id.split(':')[0]}@s.whatsapp.net`;
        delete qrCodeCache[waToken];
        delete pairingCodeCache[waToken];
        if (connectionIntervals[waToken]) {
          clearInterval(connectionIntervals[waToken]);
          delete connectionIntervals[waToken];
        }
        return { status: true, message: 'Already connected' };
      } else {
        console.log('Connection is not active, attempting to reconnect');
      }
    } catch (error) {
      console.error('Error checking existing connection:', error);
    }

    if (connections[waToken]) {
      try {
        connections[waToken].ev.removeAllListeners();
      } catch {}
      try {
        if (connections[waToken].ws && connections[waToken].ws.readyState === 1) connections[waToken].ws.close();
      } catch {}
    }

    const connectionOptions = {
      version,
      logger,
      fireInitQueries: false,
      printQRInTerminal: false,
      auth: { creds: state.creds, keys: keyStore },
      browser: Browsers.macOS('Safari'),
      markOnlineOnConnect: true,
      generateHighQualityLinkPreview: true,
      connectTimeoutMs: 30_000,
      defaultQueryTimeoutMs: undefined,
      keepAliveIntervalMs: 20_000,
      emitOwnEvents: false,
      retryRequestDelayMs: 2000,
      qrTimeout: 60000,
      shouldIgnoreJid: (jid) => isJidNewsletter(jid) || isJidStatusBroadcast(jid),
    };

    connections[waToken] = makeWASocket(connectionOptions);

    if (connections[waToken]?.ws?.on) {
      connections[waToken].ws.on('CB:iq', async (frame) => {
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

    connections[waToken].ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          const url = await QRCode.toDataURL(qr);
          qrCodeCache[waToken] = url;
        } catch {}
      }

      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = code !== DisconnectReason.loggedOut;
        if (connectionIntervals[waToken]) {
          clearInterval(connectionIntervals[waToken]);
          delete connectionIntervals[waToken];
        }
        if (shouldReconnect) {
          if (code === 515) {
            setTimeout(() => attemptConnection(), 500);
          } else {
            connectionIntervals[waToken] = setInterval(() => attemptConnection(), 10000);
          }
        } else {
          // Logged out, clear everything
          clearInterval(connectionIntervals[waToken]);
          delete connections[waToken];
          delete qrCodeCache[waToken];
          delete pairingCodeCache[waToken];
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
      } else if (connection === 'open') {
        const userId = `${connections[waToken].user.id.split(':')[0]}@s.whatsapp.net`;
        delete qrCodeCache[waToken];
        delete pairingCodeCache[waToken];
        if (connectionIntervals[waToken]) {
          clearInterval(connectionIntervals[waToken]);
          delete connectionIntervals[waToken];
        }
      }
    });

    connections[waToken].ev.on('creds.update', saveCreds);

    if (usePairingCode && !state.creds.registered) {
      const phoneNumber = await getSavedPhoneNumber(waToken);
      if (phoneNumber) {
        try {
          const code = await connections[waToken].requestPairingCode(phoneNumber);
          pairingCodeCache[waToken] = code;
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
    if (connections[waToken]?.ws?.on) {
      connections[waToken].ws.on('CB:call', async (call) => {
        if (call?.content?.[0]?.tag === 'offer') {
          const callerJid = call.content[0].attrs['call-creator'];
          await connections[waToken].sendMessage(callerJid, { text: 'Call rejected' });
        }
      });
    }

    connections[waToken].ev.on('call', async (calls) => {
      for (const call of calls) {
        if (call.status === 'offer') {
          await connections[waToken].rejectCall(call.id, call.from);
        }
      }
    });
  } catch {}

  return { connections: connections[waToken], qrcode: qrCodeCache[waToken] };
};

async function restoreSession(req, res) {
  const { token: token } = req.body;
  if (token) {
    const credentialsPath = './credentials/' + token;
    if (fs.existsSync(credentialsPath)) {
      const currentConnection = connections[token];
      if (currentConnection && (await isConnectionActive(currentConnection))) {
        return sendApiResponse(res, 200, token + ' connection already active', {
          restored: true,
          token,
          connection: true,
        });
      }

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
    const connection = connections[waToken];

    if (!connection) {
      await connectWaBeforeSend(waToken);

      const newConnection = connections[waToken];

      if (newConnection) {
        await newConnection.logout();
        delete connections[waToken];
      }
    } else {
      await connection.logout();
      delete connections[waToken];
    }

    delete qrCodeCache[waToken];

    if (connectionIntervals[waToken]) {
      clearInterval(connectionIntervals[waToken]);
      delete connectionIntervals[waToken];
    }

    const credentialPath = './credentials/' + waToken;

    if (fs.existsSync(credentialPath)) {
      fs.rmSync(credentialPath, {
        recursive: true,
        force: true,
      });
    }

    return {
      status: true,
      message: 'Deleting session and credential',
    };
  } catch (error) {
    console.log(error);

    return {
      status: false,
      message: 'Nothing deleted',
    };
  }
}

async function sendTextMessage(waToken, recipient, messageId, message) {
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
}

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
