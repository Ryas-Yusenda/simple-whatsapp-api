import fs from 'fs';
import path from 'path';
import { cache } from '../lib/cache.js';

const FILE = path.resolve('./database/whatsapp_devices.json');

const readDevices = async () => {
  try {
    const txt = await fs.promises.readFile(FILE, 'utf8');
    return JSON.parse(txt);
  } catch (e) {
    return [];
  }
};

const writeDevices = async (devices) => {
  await fs.promises.writeFile(FILE, JSON.stringify(devices, null, 2), 'utf8');
};

const getDeviceByBody = async (body) => {
  const devices = await readDevices();
  return devices.filter((d) => String(d.body) === String(body));
};

const ensureDeviceExists = async (body) => {
  const devices = await readDevices();
  const found = devices.find((d) => String(d.body) === String(body));
  if (found) return found;
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const id = devices.length > 0 ? Math.max(...devices.map((d) => d.id || 0)) + 1 : 1;
  const newDevice = {
    id,
    body: String(body),
    status: 'Disconnect',
    set_available: false,
    created_at: now,
    updated_at: now,
  };
  devices.push(newDevice);
  await writeDevices(devices);
  return newDevice;
};

const setStatus = async (deviceBody, status) => {
  try {
    const devices = await readDevices();
    const idx = devices.findIndex((d) => String(d.body) === String(deviceBody));
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    if (idx === -1) {
      const id = devices.length > 0 ? Math.max(...devices.map((d) => d.id || 0)) + 1 : 1;
      devices.push({
        id,
        body: String(deviceBody),
        status,
        set_available: false,
        created_at: now,
        updated_at: now,
      });
    } else {
      devices[idx].status = status;
      devices[idx].updated_at = now;
    }
    await writeDevices(devices);
    return true;
  } catch (e) {
    return false;
  }
};

const getConnectedDevices = async () => {
  const devices = await readDevices();
  return devices.filter((d) => String(d.status) === 'Connected');
};

const getDevice = async (deviceBody) => {
  if (cache.has('deviceall' + deviceBody)) {
    return cache.get('deviceall' + deviceBody);
  }

  const deviceResult = await getDeviceByBody(deviceBody);

  const deviceall = deviceResult.length > 0 ? deviceResult : null;
  cache.set('deviceall' + deviceBody, deviceall);
  return deviceall;
};

export { setStatus, getDeviceByBody, ensureDeviceExists, getConnectedDevices, getDevice };
