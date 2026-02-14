# Zoom Video SDK + RTMS Integration Template

A Node.js template for receiving **real-time media streams** (audio, video, transcript, screen share, chat) from Zoom Video SDK sessions via [RTMS](https://developers.zoom.us/docs/rtms/).

## Architecture

```
Zoom Video SDK Session
        │
        ▼
  Zoom Cloud (webhook)
        │
        ▼
┌───────────────────────┐
│   Express Server      │  ← POST /webhook
│   (this template)     │
│                       │
│  ┌─────────────────┐  │
│  │ Signaling WS    │──┼──→ Handshake + event subscription
│  └────────┬────────┘  │
│           │           │
│  ┌────────▼────────┐  │
│  │ Media WS        │──┼──→ Audio, Video, Transcript, Chat, Screen Share
│  └─────────────────┘  │
└───────────────────────┘
```

## Prerequisites

1. **Zoom Developer Account** — [marketplace.zoom.us](https://marketplace.zoom.us/)
2. **Video SDK App** — Create one in the Zoom Marketplace with RTMS enabled
3. **Node.js 20+**
4. **ngrok** (or similar) — to expose your local server for webhook delivery

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure credentials
cp .env.example .env
# Edit .env with your Video SDK Client ID, Client Secret, and Webhook Secret Token

# 3. Start the server
npm start

# 4. In another terminal, expose with ngrok
ngrok http 3000
```

Then set your ngrok HTTPS URL + `/webhook` (e.g. `https://abc123.ngrok.io/webhook`) as the **Event notification endpoint URL** in your Zoom App's configuration.

## Environment Variables

| Variable | Description |
|---|---|
| `ZOOM_CLIENT_ID` | Video SDK app Client ID |
| `ZOOM_CLIENT_SECRET` | Video SDK app Client Secret |
| `ZOOM_SECRET_TOKEN` | Webhook Secret Token (from your app's Feature tab) |
| `PORT` | Server port (default: 3000) |

## Handling Media Streams

The template provides callback stubs in `index.js` for each media type. Look for the `TODO` comments:

- **Audio** (case 14) — Raw PCM L16 at 16kHz mono
- **Video** (case 15) — H.264 encoded frames
- **Screen Share** (case 16) — JPEG frames
- **Transcript** (case 17) — Real-time speech-to-text
- **Chat** (case 18) — In-meeting chat messages

### Example: Saving audio to a file

```javascript
case 14: // AUDIO
  if (msg.content?.data) {
    const buffer = Buffer.from(msg.content.data, 'base64');
    fs.appendFileSync('recording.raw', buffer);
  }
  break;
```

## Project Structure

```
zoom-rtms/
├── index.js          # Main server — webhook + WebSocket handling
├── package.json      # Dependencies and scripts
├── .env.example      # Required environment variables
├── .gitignore
└── README.md
```

## Resources

- [Zoom RTMS Documentation](https://developers.zoom.us/docs/rtms/)
- [Zoom RTMS Samples (GitHub)](https://github.com/zoom/rtms-samples)
- [Zoom Video SDK](https://developers.zoom.us/docs/video-sdk/)
