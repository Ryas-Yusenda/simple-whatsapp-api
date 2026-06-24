import { prepareWAMessageMedia, generateWAMessageFromContent } from 'baileys';

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

export { formatReceipt };
