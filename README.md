# WhatsApp API Service

A minimal WhatsApp API service that manages WhatsApp device connections and sends text, photo, and document messages using the Baileys library.

## Overview

This project exposes a small Express-based REST API for:

- Connecting a WhatsApp device
- Disconnecting a device
- Restoring an existing session
- Sending text messages
- Sending photo messages
- Sending document messages

It also includes socket-based connection handling for QR code pairing and realtime device updates.

## Installation

1. Clone the repository.
2. Change into the project directory:
   ```bash
   cd whatsapp
   ```
3. Install dependencies:
   ```bash
   npm install
   ```

## Configuration

Create a `.env` file at the project root with the values below:

```env
PORT_NODE=3100
X_ACCESS_TOKEN=your-secret-token
```

- `PORT_NODE` is the port the Express server listens on.
- `X_ACCESS_TOKEN` is optional. When set, requests to `/api/v1/*` must include a matching `x-access-token` header.

## Run the Application

```bash
node app.js
```

Or with nodemon:

```bash
npx nodemon app.js
```

## API Endpoints

- `GET /` - Server root, returns running status and timestamp
- `POST /api/v1/devices/connect` - Connect or pair a device
- `POST /api/v1/devices/restore` - Restore a saved session for a device
- `POST /api/v1/devices/disconnect` - Disconnect a device and remove its credentials
- `POST /api/v1/messages/text` - Send a text message
- `POST /api/v1/messages/photo` - Send a photo message
- `POST /api/v1/messages/document` - Send a document message

## Request Headers

- `Content-Type: application/json`
- `x-access-token: <value X_ACCESS_TOKEN>`

## Request Payloads

### Connect device

```json
{
  "token": "DEVICE_TOKEN"
}
```

### Send text message

```json
{
  "token": "DEVICE_TOKEN",
  "number": "6281234567890",
  "msgid": "",
  "text": "Hello from WhatsApp API"
}
```

### Send photo message

```json
{
  "token": "DEVICE_TOKEN",
  "number": "6281234567890",
  "url": "https://example.com/sample.jpg",
  "caption": "Test image",
  "viewonce": false,
  "msgid": ""
}
```

### Send document message

```json
{
  "token": "DEVICE_TOKEN",
  "number": "6281234567890",
  "url": "https://example.com/sample.pdf",
  "caption": "Test document",
  "filename": "sample.pdf",
  "msgid": ""
}
```

## Data Storage

- Device metadata is stored in `database/whatsapp_devices.json`.
- WhatsApp credentials are stored under the `credentials/` directory.

## Notes

- A device token is created automatically when `POST /api/v1/devices/connect` is called.
- `POST /api/v1/messages/text`, `POST /api/v1/messages/photo`, and `POST /api/v1/messages/document` validate that the destination number is registered in WhatsApp and that the sender is connected.
- Unknown routes are redirected to `/`.
