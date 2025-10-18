/** BeyondConversation **
 * Real-time Speech-to-Text Web App powered by OpenAI. 
 * A vibe-coding project.
 */


/* ---------------------------------------------------------------------------------
   SERVER 
--------------------------------------------------------------------------------- */

import 'dotenv/config';
import { WebSocketServer } from 'ws';
import WebSocket from 'ws';

const PORT = process.env.PORT || 8787;
const MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview-2024-12-17';
const OPENAI_URL = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(MODEL)}`;

const WSS = new WebSocketServer({ port: PORT });
console.log(`[server] ws listening on :${PORT}`);

// Track buffered audio and response lifecycle
let approxB64SinceCommit = 0;     // How much audio we've appended since last commit
let activeResponse = false;       // Whether a response is currently running
const MIN_B64_FOR_100MS = 6400;   // ≈ (2400 samples * 2 bytes) * 4/3 base64 expansion

WSS.on('connection', async (client) => {
  console.log('[server] client connected');
  let language = 'en';

  // Connect to OpenAI Realtime
  const openai = new WebSocket(OPENAI_URL, {
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'OpenAI-Beta': 'realtime=v1',
    },
  });

  openai.on('open', () => {
    console.log('[server] connected to OpenAI Realtime');
    // Configure session for transcription via Whisper
    const sessionUpdate = {
      type: 'session.update',
      session: {
        input_audio_format: 'pcm16',
        input_audio_transcription: { model: 'whisper-1', language },
      },
    };
    openai.send(JSON.stringify(sessionUpdate));
  });

  // Browser → control/config/audio
  client.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.type === 'config' && msg.language) {
        language = msg.language;
        const upd = { 
          type: 'session.update', 
          session: {
            input_audio_format: 'pcm16',
            input_audio_transcription: { model: 'whisper-1', language } 
          } 
        };
        try { openai.send(JSON.stringify(upd)); } catch {}
        return;
      }
      if (msg.type === 'client.audio.append' && typeof msg.audio === 'string') {
        approxB64SinceCommit += msg.audio.length;
        
        console.log('[server] append b64 len =', msg.audio.length);

        openai.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: msg.audio }));
        return;
      }
      if (msg.type === 'client.flush') {
        console.log('[server] FLUSH: approxB64SinceCommit = ', approxB64SinceCommit, 'activeResponse =', activeResponse);  

        if (approxB64SinceCommit < MIN_B64_FOR_100MS) {
          // Not enough audio yet - skip committing to avoid 'buffer too small'
          return;
        }
        openai.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));

        if (!activeResponse) {
          activeResponse = true;
          openai.send(JSON.stringify({
            type:'response.create',
            response: {
              modalities: ['text'],
              conversation: null, // Keep each flush isolated
              instructions: 'Transcribe the latest audio only as plain text.'
            }
          }));
          // Reset counter after asking for a response
          approxB64SinceCommit = 0;
        }
        return;
      }
      if (msg.type === 'ping') {
        client.send(JSON.stringify({ type: 'pong', t: msg.t }));
        return;
      }
    } catch (_) { /* ignore binary */ }
  });

  // OpenAI → transcripts
  openai.on('message', (data) => {
    try {
      const text = data.toString();
      const lines = text.split('\n').filter((l) => l.trim().length > 0);

      for (const line of lines) {
        let m;
        try {
          m = JSON.parse(line);
        } catch {
          // Ignore non-JSON line
          break;
        }
        
        console.log('[server] OpenAI event type =', m.type);

        // When OpenAI starts a response
        if (m.type === 'response.created') {
          activeResponse = true;
          console.log('[server] response.created');
        }

        if (m.type === 'response.done') {
          activeResponse = false;
          console.log('[server] response.done');
        }

        // Handle content_part events carrying text/transcript
        if (m.type === 'response.content_part.added') {
          const p = m.part || {};
          const t =
            typeof p.text === 'string' ? p.text :
            typeof p.content === 'string' ? p.content :
            typeof p.transcript === 'string' ? p.transcript : '';
          if (t) client.send(JSON.stringify({ type: 'transcript', channel: 'interim', text: String(t) }));
          // Do not return; later events (delta/done) may still arrive
        }

        if (m.type === 'response.content_part.done') {
          const p = m.part || {};
          const t =
            typeof p.text === 'string' ? p.text :
            typeof p.content === 'string' ? p.content :
            typeof p.transcript === 'string' ? p.transcript : '';
          if (t) client.send(JSON.stringify({ type: 'transcript', channel: 'final', text: String(t).trim() }));
          return;
        }

        // Surface error payloads to console (helps debugging)
        if (m.type === 'error' || m.type === 'response.error') {
          console.error('[server] OpenAI error payload:', m);
          return;
        }

        // 1) Audio transcript events
        if (m.type === 'response.audio_transcript.delta') {
          const t = String(m.delta || '');
          if (t) {
            console.log('[server] ->client INTERIM:', t);

            client.send(JSON.stringify({ type: 'transcript', channel: 'interim', text: t }));
          }
          
        } else if (m.type === 'response.audio_transcript.done') {
          const t = String(m.text || '').trim();
          if (t) {
            console.log('[server] ->client FINAL:', t);
            client.send(JSON.stringify({ type: 'transcript', channel: 'final', text: t }));
          }
        }

        // 2) Text variants
        if (m.type === 'response.text.delta') {
          const t = String(m.delta || '');
          if (t) client.send(JSON.stringify({ type: 'transcript', channel: 'interim', text: t}));
        } else if (m.type === 'response.text.done') {
          const t = String(m.text || '').trim();
          if (t) client.send(JSON.stringify({ type: 'transcript', channel: 'final', text: t }));
        } else if (m.type === 'response.output_text.delta') {
          const t = String(m.delta || '');
          if (t) client.send(JSON.stringify({ type: 'transcript', channel: 'interim', text: t }));
        } else if (m.type === 'response.delta' && m.delta?.type === 'output_text.delta') {
          const t = String(m.delta.text || '');
          if (t) client.send(JSON.stringify({ type: 'transcript', channel: 'interim', text: t }));
        } else if (m.type === 'response.output_text.done') {
          const t = String(m.text || '').trim();
          if (t) client.send(JSON.stringify({ type: 'transcript', channel: 'final', text: t }));
        } else if (m.type === 'response.completed' && Array.isArray(m.response?.output_text) && m.response.output_text.length) {
          const t = String(m.response.output_text.map((x)=>x?.content || '').join(' ')).trim();
          if (t) client.send(JSON.stringify({ type: 'transcript', channel: 'final', text: t }));
        } else {
          // Optional debug
          if (m.type) console.log('[server] OpenAI event:', m.type);
        }
      }
    } catch (e) {
      console.error('[server] parse from OpenAI failed', e);
    }
  });

  const closeAll = () => { try { openai.close(); } catch {} try { client.close(); } catch {} };
  openai.on('error', (e) => { console.error('[server] OpenAI error', e); try { client.send(JSON.stringify({ type: 'status', value: 'provider-error' })); } catch {} });
  openai.on('close', closeAll);
  client.on('close', closeAll);
});