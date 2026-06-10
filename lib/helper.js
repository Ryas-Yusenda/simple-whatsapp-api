import { prepareWAMessageMedia, generateWAMessageFromContent } from 'baileys';
import mime from 'mime-types';
import fs from 'fs';
import { join } from 'path';
import axios from 'axios';
import { ulid } from 'ulid';
import sharp from 'sharp';
import os from 'os';

function formatReceipt(phoneNumber) {
  try {
    if (phoneNumber.endsWith('@g.us')) {
      return phoneNumber;
    }
    if (phoneNumber.endsWith('@newsletter')) {
      return phoneNumber;
    }
    let formattedNumber = phoneNumber.replace(/\D/g, '');
    if (formattedNumber.startsWith('08')) {
      formattedNumber = '62' + formattedNumber.substr(1);
    }
    if (formattedNumber.startsWith('00')) {
      formattedNumber = formattedNumber.substr(2);
    }
    if (!formattedNumber.endsWith('@s.whatsapp.net')) {
      formattedNumber += '@s.whatsapp.net';
    }
    return formattedNumber;
  } catch (error) {
    return phoneNumber;
  }
}

function getSavedPhoneNumber(token) {
  return new Promise((resolve, reject) => {
    const savedPhoneNumber = token;
    if (savedPhoneNumber) {
      setTimeout(() => {
        resolve(savedPhoneNumber);
      }, 2000);
    } else {
      reject(new Error('Nomor telepon tidak ditemukan.'));
    }
  });
}

const convertWebpToJpg = async (imageUrl) => {
  const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
  const jpgBuffer = await sharp(Buffer.from(response.data)).jpeg({ quality: 90 }).toBuffer();
  const tmpPath = join(os.tmpdir(), `${ulid(Date.now())}.jpg`);
  fs.writeFileSync(tmpPath, jpgBuffer);
  return tmpPath;
};

const prepareMediaMessage = async (socketBaileys, mediaOptions) => {
  let convertedTmpFile = null;
  try {
    if (mediaOptions.mediatype === 'image') {
      let isWebp = false;
      const urlLower = mediaOptions.media.toLowerCase().split('?')[0];
      if (urlLower.endsWith('.webp')) {
        isWebp = true;
      } else {
        try {
          const headResp = await axios.head(mediaOptions.media);
          const ct = (headResp.headers['content-type'] || '').toLowerCase();
          if (ct.includes('image/webp')) {
            isWebp = true;
          }
        } catch (_) {}
      }
      if (isWebp) {
        convertedTmpFile = await convertWebpToJpg(mediaOptions.media);
        mediaOptions.media = convertedTmpFile;
      }
    }

    const preparedMedia = await prepareWAMessageMedia(
      { [mediaOptions.mediatype]: { url: mediaOptions.media } },
      { upload: socketBaileys.waUploadToServer },
    );
    const messageKey = mediaOptions.mediatype + 'Message';

    if (mediaOptions.mediatype === 'document' && !mediaOptions.fileName) {
      const fileNameRegex = /.*\/(.+?)\./;
      const fileNameMatch = fileNameRegex.exec(mediaOptions.media);
      mediaOptions.fileName = fileNameMatch[1];
    }

    let mimetype = mime.lookup(mediaOptions.media);
    if (!mimetype) {
      const response = await axios.head(mediaOptions.media);
      mimetype = response.headers['content-type'];
    }
    if (mediaOptions.media.includes('.cdr')) {
      mimetype = 'application/cdr';
    }

    preparedMedia[messageKey].caption = mediaOptions?.caption;
    preparedMedia[messageKey].mimetype = mimetype;
    preparedMedia[messageKey].fileName = mediaOptions.fileName;

    if (mediaOptions.mediatype === 'video') {
      preparedMedia[messageKey].jpegThumbnail = Uint8Array.from(
        fs.readFileSync(join(process.cwd(), 'public', 'images', 'video-cover.png')),
      );
      preparedMedia[messageKey].gifPlayback = false;
    }

    let normalizedUserJid = socketBaileys.user.id.replace(/:\d+/, '');
    const result = await generateWAMessageFromContent(
      '',
      { [messageKey]: { ...preparedMedia[messageKey] } },
      { userJid: normalizedUserJid },
    );
    if (convertedTmpFile) fs.unlinkSync(convertedTmpFile);
    return result;
  } catch (prepareError) {
    if (convertedTmpFile)
      try {
        fs.unlinkSync(convertedTmpFile);
      } catch (_) {}
    console.log('error prepare', prepareError);
    return false;
  }
};

export { formatReceipt, getSavedPhoneNumber, prepareMediaMessage };
