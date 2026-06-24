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
import { formatReceipt } from './helper.js';
import { sendApiResponse } from './response.js';
import MAIN_LOGGER from './pino.js';

import mime from 'mime-types';

let sock = null;
let qrCodeCache = null;
let pairingCodeCache = null;
let connectionInterval = null;

const logger = MAIN_LOGGER.child({});

const getCredentialPath = () => 'credentials';
const getConnection = () => sock;
const hasExistingSession = () => {
  try {
    return fs.existsSync(getCredentialPath()) && fs.readdirSync(getCredentialPath()).length > 0;
  } catch {
    return false;
  }
};

async function isConnectionActive(connection) {
  try {
    if (!connection?.user?.id) return false;
    const jid = `${connection.user.id.split(':')[0]}@s.whatsapp.net`;
    await connection.fetchStatus(jid);
    return true;
  } catch {
    return false;
  }
}

async function connectDevice(usePairingCode = false) {
  const credentialPath = getCredentialPath();
  const { state, saveCreds } = await useMultiFileAuthState(credentialPath);
  const sessionAlreadyScanned = Boolean(state?.creds?.registered) && hasExistingSession();
  const keyStore = makeCacheableSignalKeyStore(state.keys, logger);
  const { version, isLatest } = await fetchLatestBaileysVersion();

  if (sessionAlreadyScanned) {
    return { connections: null, qrcode: null, status: true, message: 'Existing session loaded' };
    console.log('Existing scanned session found, reusing saved credentials without fresh login request.');
  }

  async function attemptConnection() {
    try {
      if (getConnection()) {
        if (await isConnectionActive(getConnection())) {
          console.log('Connection is active');
          const userId = `${getConnection().user.id.split(':')[0]}@s.whatsapp.net`;
          qrCodeCache = null;
          pairingCodeCache = null;
          if (connectionInterval) {
            clearInterval(connectionInterval);
            connectionInterval = null;
          }
          return { status: true, message: 'Already connected' };
        } else {
          console.log('Connection is not active, attempting to reconnect');
        }
      } else {
        console.log('Connection is not exist, attempting to reconnect');
      }
    } catch (error) {
      console.error('Error checking existing connection:', error);
    }

    if (getConnection()) {
      try {
        getConnection().ev.removeAllListeners();
      } catch {}
      try {
        if (getConnection().ws && getConnection().ws.readyState === 1) getConnection().ws.close();
      } catch {}
    }

    const connectionOptions = {
      version,
      logger,
      fireInitQueries: false,
      printQRInTerminal: false,
      auth: { creds: state.creds, keys: keyStore },
      browser: Browsers.macOS('Chrome'),
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

    sock = makeWASocket(connectionOptions);

    if (getConnection()?.ws?.on) {
      getConnection().ws.on('CB:iq', async (frame) => {
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

    getConnection().ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr && !sessionAlreadyScanned) {
        try {
          const url = await QRCode.toDataURL(qr);
          qrCodeCache = url;
        } catch {}
      }

      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = code !== DisconnectReason.loggedOut;
        if (connectionInterval) {
          clearInterval(connectionInterval);
          connectionInterval = null;
        }
        if (shouldReconnect) {
          if (code === 515) {
            setTimeout(() => attemptConnection(), 500);
          } else {
            connectionInterval = setInterval(() => attemptConnection(), 10000);
          }
        } else {
          // Logged out, clear everything
          clearInterval(connectionInterval);
          connectionInterval = null;
          sock = null;
          qrCodeCache = null;
          pairingCodeCache = null;
          fs.existsSync(getCredentialPath()) &&
            (fs.rmSync(
              getCredentialPath(),
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
            console.log(`${getCredentialPath()} is deleted`));
        }
      } else if (connection === 'open') {
        const userId = `${getConnection().user.id.split(':')[0]}@s.whatsapp.net`;
        qrCodeCache = null;
        pairingCodeCache = null;
        if (connectionInterval) {
          clearInterval(connectionInterval);
          connectionInterval = null;
        }
      }
    });

    getConnection().ev.on('creds.update', saveCreds);

    if (usePairingCode && !sessionAlreadyScanned && !state.creds.registered) {
      const phoneNumber = process.env.SENDER_NUMBER || 'default-session';
      if (phoneNumber) {
        try {
          const code = await getConnection().requestPairingCode(phoneNumber);
          pairingCodeCache = code;
        } catch (error) {
          console.error('Failed to request pairing code:', error);
        }
      } else {
        console.error('No saved phone number found for pairing code generation');
      }
    }
  }

  await attemptConnection();

  try {
    if (getConnection()?.ws?.on) {
      getConnection().ws.on('CB:call', async (call) => {
        if (call?.content?.[0]?.tag === 'offer') {
          const callerJid = call.content[0].attrs['call-creator'];
          await getConnection().sendMessage(callerJid, { text: 'Call rejected' });
        }
      });
    }

    getConnection().ev.on('call', async (calls) => {
      for (const call of calls) {
        if (call.status === 'offer') {
          await getConnection().rejectCall(call.id, call.from);
        }
      }
    });
  } catch {}

  return { connections: getConnection(), qrcode: qrCodeCache };
}

async function restoreSession(req, res) {
  const token = process.env.SENDER_NUMBER || 'default-session';
  if (token) {
    const credentialsPath = getCredentialPath();
    if (fs.existsSync(credentialsPath)) {
      const currentConnection = getConnection();
      if (currentConnection && (await isConnectionActive(currentConnection))) {
        return sendApiResponse(res, 200, token + ' connection already active', {
          restored: false, // already active, no need to restore
          token,
          connection: true,
        });
      }

      sock = null;
      const connectionResult = await connectWaBeforeSend();
      return connectionResult
        ? sendApiResponse(res, 200, token + ' connection restored', {
            restored: true,
            token,
            connection: getConnection() ? true : false,
          })
        : sendApiResponse(res, 200, token + ' connection failed', {
            restored: false,
            token,
            connection: getConnection() ? true : false,
          });
    }
    return sendApiResponse(res, 400, token + ' Connection failed,please scan first', {});
  }
  return sendApiResponse(res, 400, 'Wrong Parameterss', {});
}

async function disconnectDevice() {
  try {
    const connection = getConnection();

    if (!connection) {
      await connectWaBeforeSend();

      const newConnection = getConnection();

      if (newConnection) {
        await newConnection.logout();
        sock = null;
      }
    } else {
      await connection.logout();
      sock = null;
    }

    qrCodeCache = null;

    if (connectionInterval) {
      clearInterval(connectionInterval);
      connectionInterval = null;
    }

    const credentialPath = getCredentialPath();

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

async function sendTextMessage(recipient, messageId, message) {
  try {
    let result;

    const connection = getConnection() || ((await connectWaBeforeSend()) && getConnection());
    if (!connection) return false;

    const jid = formatReceipt(recipient);

    if (messageId == '') {
      result = await connection.sendMessage(jid, { text: message });
    } else {
      const quotedTry1 = {
        key: { remoteJid: jid, id: messageId, fromMe: false },
        message: { conversation: '' },
      };
      result = await connection.sendMessage(jid, { text: message }, { quoted: quotedTry1 });
    }

    return result;
  } catch (error) {
    return false;
  }
}

async function sendPhoto(recipient, mediaPath, caption, viewonce, msgid) {
  try {
    const connection = getConnection() || ((await connectWaBeforeSend()) && getConnection());
    if (!connection) return false;

    const formattedRecipient = formatReceipt(recipient);
    const options = msgid
      ? {
          quoted: {
            key: { remoteJid: formattedRecipient, id: msgid, fromMe: false },
            message: { conversation: '' },
          },
        }
      : undefined;

    return await connection.sendMessage(
      formattedRecipient,
      {
        image: { url: mediaPath },
        caption: caption ?? '',
        viewOnce: viewonce ?? false,
      },
      options,
    );
  } catch (error) {
    return false;
  }
}

async function sendDocument(recipient, mediaPath, caption, fileName, msgid) {
  try {
    const connection = getConnection() || ((await connectWaBeforeSend()) && getConnection());
    if (!connection) return false;

    const formattedRecipient = formatReceipt(recipient);
    const options = msgid
      ? {
          quoted: {
            key: { remoteJid: formattedRecipient, id: msgid, fromMe: false },
            message: { conversation: '' },
          },
        }
      : undefined;

    if (!fileName) {
      const match = /.*\/(.+?)\./.exec(mediaPath);
      fileName = match?.[1] ?? 'document';
    }

    let mimetype = mime.lookup(mediaPath);

    if (!mimetype) {
      const res = await fetch(mediaPath, { redirect: 'follow' });
      mimetype = res.headers.get('content-type');
    }

    mimetype ||= 'application/octet-stream';

    return await connection.sendMessage(
      formattedRecipient,
      {
        document: { url: mediaPath },
        fileName,
        mimetype,
        caption: caption ?? '',
      },
      options,
    );
  } catch (error) {
    console.error(error);
    return false;
  }
}

async function isConnected(phoneNumber) {
  try {
    if (!getConnection()) {
      const connectionResult = await connectWaBeforeSend();
      if (!connectionResult) {
        return { status: false, message: 'Your whatsapp sender not connected' };
      }
    }
    if (phoneNumber.includes('@g.us')) {
      return { status: true, message: 'Group chat is valid' };
    } else if (phoneNumber.includes('@newsletter')) {
      return { status: true, message: 'Newsletter chat is valid' };
    } else {
      const [isOnWhatsApp] = await getConnection().onWhatsApp('+' + phoneNumber);
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

async function connectWaBeforeSend() {
  let isConnected = undefined;
  const connectResult = await connectDevice();
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
  getConnection,
  hasExistingSession,
  connectDevice,
  restoreSession,
  disconnectDevice,
  sendTextMessage,
  sendPhoto,
  sendDocument,
  isConnected,
  connectWaBeforeSend,
};
