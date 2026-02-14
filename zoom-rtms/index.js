/**
 * Zoom Video SDK + RTMS Integration Template
 *
 * This template provides a working foundation for receiving real-time media
 * streams from Zoom Video SDK sessions via RTMS (Real-Time Media Streams).
 *
 * Architecture:
 *   1. Express server receives webhook events from Zoom
 *   2. On `session.rtms_started`, a signaling WebSocket connects to Zoom's server
 *   3. After signaling handshake, a media WebSocket connects to receive streams
 *   4. Media callbacks fire for audio, video, transcript, screen share, and chat
 *
 * Usage:
 *   1. Copy .env.example → .env and fill in your credentials
 *   2. npm install
 *   3. npm start (expose via ngrok for webhook delivery)
 */

import express from 'express';
import WebSocket from 'ws';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

// ─── Configuration ───────────────────────────────────────────────────────────

const config = {
    port: process.env.PORT || 3000,
    webhookPath: process.env.WEBHOOK_PATH || '/webhook',
    clientId: process.env.ZOOM_CLIENT_ID,
    clientSecret: process.env.ZOOM_CLIENT_SECRET,
    zoomSecretToken: process.env.ZOOM_SECRET_TOKEN,
};

// ─── Active RTMS Connections ─────────────────────────────────────────────────

const activeConnections = new Map();

// ─── Utility Functions ───────────────────────────────────────────────────────

/**
 * Generate HMAC-SHA256 signature for RTMS authentication.
 * The signature is computed over: clientId,sessionId,streamId
 */
function generateSignature(sessionId, streamId) {
    const message = `${config.clientId},${sessionId},${streamId}`;
    return crypto
        .createHmac('sha256', config.clientSecret)
        .update(message)
        .digest('hex');
}

// ─── Media Message Handler ───────────────────────────────────────────────────

/**
 * Processes incoming messages on the media WebSocket.
 * This is where you plug in your audio/video/transcript processing logic.
 */
function handleMediaMessage(data, { conn, mediaWs, signalingSocket, sessionId, streamId }) {
    try {
        const msg = JSON.parse(data.toString());

        switch (msg.msg_type) {
            case 4: // DATA_HAND_SHAKE_RESP
                if (msg.status_code === 0) {
                    console.log('[Media] ✅ Handshake successful — requesting stream start');
                    signalingSocket.send(JSON.stringify({
                        msg_type: 7,
                        rtms_stream_id: streamId,
                    }));
                    conn.media.state = 'streaming';
                } else {
                    console.error(`[Media] ❌ Handshake failed: status_code=${msg.status_code}`);
                }
                break;

            case 12: // KEEP_ALIVE_REQ
                mediaWs.send(JSON.stringify({
                    msg_type: 13,
                    timestamp: msg.timestamp,
                }));
                break;

            // ╔══════════════════════════════════════════════════════════════════╗
            // ║  MEDIA CALLBACKS — Add your processing logic in these cases    ║
            // ╚══════════════════════════════════════════════════════════════════╝

            case 14: // AUDIO
                if (msg.content?.data) {
                    const { user_id, user_name, data: audioData } = msg.content;
                    const buffer = Buffer.from(audioData, 'base64');

                    // TODO: Process audio buffer (PCM L16, 16kHz, mono)
                    // Example: send to a speech-to-text service, save to file, etc.
                    console.log(`[Audio] ${user_name} (${user_id}) — ${buffer.length} bytes`);
                }
                break;

            case 15: // VIDEO
                if (msg.content?.data) {
                    const { user_id, user_name, data: videoData, timestamp } = msg.content;
                    const buffer = Buffer.from(videoData, 'base64');

                    // TODO: Process video buffer (H.264 encoded)
                    // Example: pipe to ffmpeg, analyze frames, save recording, etc.
                    console.log(`[Video] ${user_name} (${user_id}) — ${buffer.length} bytes`);
                }
                break;

            case 16: // SCREEN SHARE
                if (msg.content?.data) {
                    const { user_id, user_name, data: shareData } = msg.content;
                    const buffer = Buffer.from(shareData, 'base64');

                    // TODO: Process screen share buffer (JPEG frames)
                    console.log(`[ScreenShare] ${user_name} (${user_id}) — ${buffer.length} bytes`);
                }
                break;

            case 17: // TRANSCRIPT
                if (msg.content?.data) {
                    const { user_name, data: text } = msg.content;

                    // TODO: Process real-time transcript text
                    console.log(`[Transcript] ${user_name}: ${text}`);
                }
                break;

            case 18: // CHAT
                if (msg.content?.data) {
                    const { user_name, data: text } = msg.content;

                    // TODO: Process in-meeting chat messages
                    console.log(`[Chat] ${user_name}: ${text}`);
                }
                break;

            default:
                break;
        }
    } catch (err) {
        console.error('[Media] Failed to parse message:', err.message);
    }
}

// ─── Media WebSocket ─────────────────────────────────────────────────────────

function connectToMediaWebSocket(mediaUrl, sessionId, streamId, signalingSocket, conn) {
    console.log(`[Media] Connecting for session ${sessionId}...`);

    const mediaWs = new WebSocket(mediaUrl, [], { rejectUnauthorized: false });
    conn.media.socket = mediaWs;
    conn.media.state = 'connecting';

    mediaWs.on('open', () => {
        if (!conn.shouldReconnect) {
            mediaWs.close();
            return;
        }

        const signature = generateSignature(sessionId, streamId);

        // Request all media types: audio + video + transcript + screen share + chat
        const handshakeMsg = {
            msg_type: 3, // DATA_HAND_SHAKE_REQ
            protocol_version: 1,
            meeting_uuid: sessionId,
            session_id: sessionId,
            rtms_stream_id: streamId,
            signature,
            media_type: 32, // Bitmask: all media types
            payload_encryption: false,
            media_params: {
                audio: {
                    content_type: 1, // RTP
                    sample_rate: 1,  // 16kHz
                    channel: 1,      // Mono
                    codec: 1,        // L16 (raw PCM)
                    data_opt: 1,     // Mixed stream (all participants)
                    send_rate: 100,  // Milliseconds between packets
                },
                video: {
                    codec: 7,        // H.264
                    data_opt: 3,     // Single active speaker stream
                    resolution: 2,   // 720p
                    fps: 25,
                },
                deskshare: {
                    codec: 5,        // JPEG
                    resolution: 2,   // 720p
                    fps: 1,
                },
                chat: {
                    content_type: 5, // TEXT
                },
                transcript: {
                    content_type: 5, // TEXT
                },
            },
        };

        console.log('[Media] Sending data handshake...');
        mediaWs.send(JSON.stringify(handshakeMsg));
        conn.media.state = 'authenticated';
    });

    mediaWs.on('message', (data) => {
        handleMediaMessage(data, {
            conn,
            mediaWs,
            signalingSocket,
            sessionId,
            streamId,
        });
    });

    mediaWs.on('close', () => {
        console.warn(`[Media] Connection closed for ${sessionId}`);
        conn.media.state = 'closed';

        if (!conn.shouldReconnect) return;

        // Attempt reconnection if signaling is still alive
        if (conn.signaling.state === 'ready' && conn.signaling.socket?.readyState === WebSocket.OPEN) {
            console.log('[Media] Reconnecting in 3s...');
            setTimeout(() => {
                connectToMediaWebSocket(mediaUrl, sessionId, streamId, conn.signaling.socket, conn);
            }, 3000);
        } else {
            console.warn('[Media] Signaling not ready — restarting both connections...');
            connectToSignalingWebSocket(sessionId, streamId, conn.serverUrls, conn);
        }
    });

    mediaWs.on('error', (err) => {
        console.error(`[Media] Error: ${err.message}`);
        conn.media.state = 'error';
    });
}

// ─── Signaling WebSocket ─────────────────────────────────────────────────────

function connectToSignalingWebSocket(sessionId, streamId, serverUrls, existingConn) {
    console.log(`[Signaling] Connecting for session ${sessionId}...`);

    if (!serverUrls || !serverUrls.startsWith('ws')) {
        console.error(`[Signaling] ❌ Invalid WebSocket URL: ${serverUrls}`);
        return;
    }

    const signalingWs = new WebSocket(serverUrls, [], { rejectUnauthorized: false });

    // Create or reuse connection entry
    const conn = existingConn || {
        sessionId,
        streamId,
        serverUrls,
        shouldReconnect: true,
        signaling: { socket: null, state: 'connecting', lastKeepAlive: null },
        media: { socket: null, state: 'idle', lastKeepAlive: null },
    };

    if (!existingConn) {
        activeConnections.set(sessionId, conn);
    }

    conn.signaling.socket = signalingWs;
    conn.signaling.state = 'connecting';

    signalingWs.on('open', () => {
        if (!conn.shouldReconnect) {
            signalingWs.close();
            return;
        }

        const signature = generateSignature(sessionId, streamId);

        const handshakeMsg = {
            msg_type: 1, // SIGNALING_HAND_SHAKE_REQ
            meeting_uuid: sessionId,
            session_id: sessionId,
            rtms_stream_id: streamId,
            signature,
        };

        console.log('[Signaling] Sending handshake...');
        signalingWs.send(JSON.stringify(handshakeMsg));
        conn.signaling.state = 'authenticated';
    });

    signalingWs.on('message', (data) => {
        let msg;
        try {
            msg = JSON.parse(data.toString());
        } catch {
            console.warn('[Signaling] Invalid JSON received');
            return;
        }

        switch (msg.msg_type) {
            case 2: // SIGNALING_HAND_SHAKE_RESP
                if (msg.status_code === 0) {
                    const mediaUrl = msg.media_server?.server_urls?.audio;
                    console.log(`[Signaling] ✅ Handshake OK — media URL: ${mediaUrl}`);
                    conn.signaling.state = 'ready';

                    // Connect to media WebSocket
                    connectToMediaWebSocket(mediaUrl, sessionId, streamId, signalingWs, conn);

                    // Subscribe to signaling events
                    signalingWs.send(JSON.stringify({
                        msg_type: 5,
                        events: [
                            { event_type: 2, subscribe: true }, // ACTIVE_SPEAKER_CHANGE
                            { event_type: 3, subscribe: true }, // PARTICIPANT_JOIN
                            { event_type: 4, subscribe: true }, // PARTICIPANT_LEAVE
                        ],
                    }));
                } else {
                    console.error(`[Signaling] ❌ Handshake failed: status_code=${msg.status_code}`);
                }
                break;

            case 6: // EVENT
                if (msg.event) {
                    switch (msg.event.event_type) {
                        case 1:
                            console.log(`[Event] First packet at ${msg.event.timestamp}`);
                            break;
                        case 2:
                            console.log(`[Event] Active speaker: ${msg.event.user_name}`);
                            break;
                        case 3:
                            console.log(`[Event] Participant joined: ${msg.event.user_name}`);
                            break;
                        case 4:
                            console.log(`[Event] Participant left: ${msg.event.user_name}`);
                            break;
                        default:
                            console.log(`[Event] Unknown event_type: ${msg.event.event_type}`);
                    }
                }
                break;

            case 8: // STREAM_STATE_CHANGED
                console.log(`[Signaling] Stream state changed:`, msg.state, msg.reason ?? '');
                if (msg.reason === 6 && msg.state === 4) {
                    // Session ended — clean up
                    cleanupConnection(sessionId);
                }
                break;

            case 9: // SESSION_STATE_CHANGED
                console.log(`[Signaling] Session state changed:`, msg.state);
                break;

            case 12: // KEEP_ALIVE_REQ
                conn.signaling.lastKeepAlive = Date.now();
                signalingWs.send(JSON.stringify({
                    msg_type: 13,
                    timestamp: msg.timestamp,
                }));
                break;

            default:
                console.log(`[Signaling] Unhandled msg_type: ${msg.msg_type}`);
                break;
        }
    });

    signalingWs.on('close', (code, reason) => {
        console.log(`[Signaling] Closed for ${sessionId} (code: ${code})`);
        conn.signaling.state = 'closed';

        if (conn.shouldReconnect) {
            console.log('[Signaling] Reconnecting in 3s...');
            setTimeout(() => {
                if (conn.shouldReconnect) {
                    connectToSignalingWebSocket(sessionId, streamId, conn.serverUrls, conn);
                }
            }, 3000);
        }
    });

    signalingWs.on('error', (err) => {
        console.error(`[Signaling] Error: ${err.message}`);
        conn.signaling.state = 'error';
    });
}

// ─── Connection Cleanup ──────────────────────────────────────────────────────

function cleanupConnection(sessionId) {
    const conn = activeConnections.get(sessionId);
    if (!conn) return;

    console.log(`[Cleanup] Closing connections for session ${sessionId}`);
    conn.shouldReconnect = false;

    for (const type of ['signaling', 'media']) {
        const ws = conn[type]?.socket;
        if (ws && typeof ws.close === 'function') {
            conn[type].state = 'closed';
            if (ws.readyState === WebSocket.CONNECTING) {
                ws.once('open', () => ws.close());
            } else {
                ws.close();
            }
        }
    }

    activeConnections.delete(sessionId);
}

// ─── Express Server ──────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// Health check
app.get('/', (_, res) => {
    res.json({
        status: 'running',
        activeSessions: activeConnections.size,
    });
});

// Zoom Webhook endpoint
app.post(config.webhookPath, (req, res) => {
    const { event, payload } = req.body;
    console.log(`[Webhook] Event received: ${event}`);

    // ── Zoom URL Validation (CRC challenge) ──
    if (event === 'endpoint.url_validation' && payload?.plainToken) {
        if (!config.zoomSecretToken) {
            console.error('[Webhook] ❌ ZOOM_SECRET_TOKEN is not set — cannot validate URL');
            return res.status(500).json({ error: 'ZOOM_SECRET_TOKEN not configured' });
        }

        const hash = crypto
            .createHmac('sha256', config.zoomSecretToken)
            .update(payload.plainToken)
            .digest('hex');

        console.log('[Webhook] ✅ URL validation response sent');
        return res.json({
            plainToken: payload.plainToken,
            encryptedToken: hash,
        });
    }

    // Acknowledge all other events immediately
    res.sendStatus(200);

    // ── RTMS Started ──
    if (event === 'session.rtms_started') {
        const { session_id, rtms_stream_id, server_urls } = payload;
        console.log(`[Webhook] RTMS started for session ${session_id}`);

        connectToSignalingWebSocket(session_id, rtms_stream_id, server_urls);
    }

    // ── RTMS Stopped ──
    else if (event === 'session.rtms_stopped') {
        const { session_id } = payload;
        console.log(`[Webhook] RTMS stopped for session ${session_id}`);

        cleanupConnection(session_id);
    }
});

// ─── Start Server ────────────────────────────────────────────────────────────

const server = app.listen(config.port, () => {
    console.log('');
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║         Zoom Video SDK + RTMS Template Server               ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║  Server:    http://localhost:${config.port}                          ║`);
    console.log(`║  Webhook:   http://localhost:${config.port}${config.webhookPath}                  ║`);
    console.log('║                                                              ║');
    console.log(`║  Client ID: ${config.clientId ? '✅ Set' : '❌ Not set'}                                      ║`);
    console.log(`║  Secret:    ${config.clientSecret ? '✅ Set' : '❌ Not set'}                                      ║`);
    console.log(`║  Token:     ${config.zoomSecretToken ? '✅ Set' : '❌ Not set'}                                      ║`);
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log('💡 Expose this server with ngrok:');
    console.log(`   ngrok http ${config.port}`);
    console.log('   Then set the ngrok URL as your Webhook endpoint in the Zoom App.');
    console.log('');
});

// ─── Graceful Shutdown ───────────────────────────────────────────────────────

process.on('SIGINT', () => {
    console.log('\n[Shutdown] Cleaning up...');
    for (const sessionId of activeConnections.keys()) {
        cleanupConnection(sessionId);
    }
    server.close(() => {
        console.log('[Shutdown] Server closed.');
        process.exit(0);
    });
});
