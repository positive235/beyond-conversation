'use client';

/** BeyondConversation **
 * Real-time Speech-to-Text Web App powered by OpenAI.
 * A vibe-coding project.
 * 
 * * Setup
 *   server/.env
 *     OPENAI_API_KEY=your-openai-api-key
 *     OPENAI_REALTIME_MODEL=openai-model-you-want-to-use
 *     PORT=port-number-you-use
 *
 *   web/.env.local
 *     NEXT_PUBLIC_WS_URL=your-public-ws-url
 */

 import React, { useEffect, useRef, useState } from 'react';

 // ---------- Small utilities (pure/testable where possible) ----------
 const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
 
 function downloadText(filename: string, text: string) {
   const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
   const url = URL.createObjectURL(blob);
   const a = document.createElement('a');
   a.href = url;
   a.download = filename;
   a.click();
   URL.revokeObjectURL(url);
 }
 
 // Merge finals + interim into a single display string (pure & testable)
 export function composeTranscript(finals: string[], interim: string): string {
   const base = finals.join(' ').trim();
   return (base + (base && interim ? ' ' : '') + interim).trim();
 }
 
 // Very light interim smoothing to reduce flicker
 export function smoothInterim(prevInterim: string, nextInterim: string): string {
   if (!prevInterim) return nextInterim;
   if (!nextInterim) return '';
   if (prevInterim.startsWith(nextInterim) && prevInterim.length > nextInterim.length) return prevInterim;
   return nextInterim;
 }
 
 // PCM utils (pure)
 export function floatToPCM16(f32: Float32Array): Int16Array {
   const out = new Int16Array(f32.length);
   for (let i = 0; i < f32.length; i++) {
     const s = Math.max(-1, Math.min(1, f32[i]));
     out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
   }
   return out;
 }
 
 export function base64FromPCM16(i16: Int16Array): string {
   const buf = new Uint8Array(i16.buffer);
   let bin = '';
   for (let i = 0; i < buf.byteLength; i++) bin += String.fromCharCode(buf[i]);
   // eslint-disable-next-line no-undef
   return btoa(bin);
 }
 
 // Downsample from srcRate to 24000 Hz, mono
 export function downsampleTo24kHz(samples: Float32Array, srcRate: number): Float32Array {
   if (srcRate === 24000) return samples;
   const ratio = srcRate / 24000;
   const newLen = Math.floor(samples.length / ratio);
   const out = new Float32Array(newLen);
   let acc = 0;
   let idx = 0;
   for (let i = 0; i < newLen; i++) {
     const nextAcc = (i + 1) * ratio;
     let sum = 0, count = 0;
     while (acc < nextAcc && idx < samples.length) {
       sum += samples[idx++];
       count++;
       acc++;
     }
     out[i] = count ? sum / count : 0;
   }
   return out;
 }
 
 // Secure origin helpers
 export function isSecureOriginLike(hostname: string, protocol: string): boolean {
   const isLocalhost = ['localhost', '127.0.0.1', '::1'].includes(hostname);
   return protocol === 'https:' || isLocalhost;
 }
 function isSecureRuntime(): boolean {
   try {
     // @ts-ignore
     if (typeof window !== 'undefined' && window.isSecureContext) return true;
     if (typeof location !== 'undefined') return isSecureOriginLike(location.hostname, location.protocol);
   } catch {}
   return false;
 }
 
 // Friendly mic error mapping
 export type FriendlyMicErrorCode =
   | 'permission-denied'
   | 'no-device'
   | 'hardware-busy'
   | 'constraints'
   | 'insecure-context'
   | 'unsupported'
   | 'unknown';
 
 export function friendlyMicError(err: unknown): { code: FriendlyMicErrorCode; message: string } {
   const name = (err as any)?.name || (err as any)?.code || 'UnknownError';
   switch (name) {
     case 'NotAllowedError':
     case 'SecurityError':
       return { code: 'permission-denied', message: 'Microphone permission was blocked. Allow mic access and reload.' };
     case 'NotFoundError':
     case 'DevicesNotFoundError':
       return { code: 'no-device', message: 'No microphone found. Plug in or enable a mic and try again.' };
     case 'NotReadableError':
     case 'AbortError':
       return { code: 'hardware-busy', message: 'Microphone is in use by another app. Close calls/recorders and retry.' };
     case 'OverconstrainedError':
       return { code: 'constraints', message: 'Requested audio constraints are not supported by your device/browser.' };
     case 'TypeError':
       return { code: 'insecure-context', message: 'Use HTTPS or localhost to access the microphone.' };
     default:
       return { code: 'unknown', message: 'Could not access the microphone. Check site permissions and try again.' };
   }
 }
 
 // ---------- Types for real-time lines ----------
 export type FinalLine = { id: string; text: string; ts: number };
 
 // ---------- Component ----------
 export default function LiveTranscribe(): JSX.Element {
   const [permission, setPermission] = useState<'idle' | 'prompt' | 'granted' | 'denied'>('idle');
   const [recording, setRecording] = useState(false);
   const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
   const [interim, _setInterim] = useState('');
   const [finals, setFinals] = useState<string[]>([]);
   const [lines, setLines] = useState<FinalLine[]>([]);
   const [language, setLanguage] = useState('en');
   const [testOutput, setTestOutput] = useState<string[]>([]);
   const [micError, setMicError] = useState<{ code: FriendlyMicErrorCode; message: string } | null>(null);
   const [autoScroll, setAutoScroll] = useState(true);
   const [latencyMs, setLatencyMs] = useState<number | null>(null);
   const [mounted, setMounted] = useState(false);
   const [originText, setOriginText] = useState('');
 
   const wsRef = useRef<WebSocket | null>(null);
   const streamRef = useRef<MediaStream | null>(null);
   const paneRef = useRef<HTMLDivElement | null>(null);
   const rafInterimRef = useRef<number | null>(null);
   const audioCtxRef = useRef<AudioContext | null>(null);
   const workletNodeRef = useRef<AudioWorkletNode | null>(null);
   const flushTimerRef = useRef<number | null>(null);
   const lastPingRef = useRef<number | null>(null);
   const sampleRateRef = useRef<number>(48000);

   // client-side sample accumulator (24 kHz mono)
  const pendingSamplesRef = useRef<Float32Array | null>(null);
  const THRESHOLD_SAMPLES_24K = 2400; // ≈100ms at 24kHz
 
   const WS_URL: string = (() => {
     const envUrl =
       (typeof process !== 'undefined' &&
         (process as any).env &&
         (process as any).env.NEXT_PUBLIC_WS_URL) ||
       '';
     const isHttps = typeof location !== 'undefined' && location.protocol === 'https:';

     if (envUrl) {
       if (isHttps && envUrl.startsWith('ws://')) {
         try {
           const u = new URL(envUrl);
           return `wss://${u.hostname}${u.port ? `:${u.port}` : ''}${u.pathname || ''}${u.search || ''}`;
         } catch {
           return envUrl.replace(/^ws:\/\//, 'wss://');
         }
       }
       return envUrl;
     }

     if (isHttps) return `wss://${location.hostname}:8787`;
     return 'ws://localhost:8787';
   })();

   const CANDIDATE_WS_URLS: string[] = (() => {
     const isHttps = typeof location !== 'undefined' && location.protocol === 'https:';
     const proto = isHttps ? 'wss' : 'ws';
     const host = (typeof location !== 'undefined' && location.hostname) || 'localhost';
  
     const urls = new Set<string>([
       WS_URL,                            // env / resolver
       `${proto}://${host}:8787`,         // current host
       `${proto}://127.0.0.1:8787`,       // loopback IPv4
       `${proto}://localhost:8787`,       // localhost
     ].filter(Boolean) as string[]);
  
     return Array.from(urls);
   })();

   const setInterim = (next: string) => {
     if (rafInterimRef.current) cancelAnimationFrame(rafInterimRef.current);
     rafInterimRef.current = requestAnimationFrame(() => {
       _setInterim((prev) => smoothInterim(prev, next));
     });
   };
 
   useEffect(() => {
     if (!autoScroll || !paneRef.current) return;
     paneRef.current.scrollTop = paneRef.current.scrollHeight;
   }, [interim, lines, autoScroll]);
 
   useEffect(() => {
     let cancelled = false;
     
     setMounted(true);
     try { setOriginText(window.location.protocol + '//' + window.location.host); } catch {}

     (async () => {
       try {
         // @ts-ignore
         const res = await navigator?.permissions?.query?.({ name: 'microphone' });
         if (!res || cancelled) return;
         const map: Record<string, 'prompt' | 'granted' | 'denied'> = { prompt: 'prompt', granted: 'granted', denied: 'denied' };
         setPermission(map[res.state] || 'idle');
         res.onchange = () => {
           // @ts-ignore
           setPermission(map[res.state] || 'idle');
         };
       } catch {}
     })();
     return () => {
       cancelled = true;
       try { if (flushTimerRef.current) window.clearInterval(flushTimerRef.current); } catch {}
       try { workletNodeRef.current?.port.postMessage({ type: 'stop' }); } catch {}
       try { audioCtxRef.current?.close(); } catch {}
       try { if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) wsRef.current.close(); } catch {}
       try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch {}
       if (rafInterimRef.current) cancelAnimationFrame(rafInterimRef.current);
     };
   }, []);
 
   async function requestMicPermission(): Promise<MediaStream | null> {
     setMicError(null);
     if (!isSecureRuntime()) {
       const e = friendlyMicError({ name: 'TypeError' });
       setMicError(e);
       setPermission('denied');
       return null;
     }
     if (!navigator?.mediaDevices?.getUserMedia) {
       setMicError({ code: 'unsupported', message: 'This browser does not support getUserMedia.' });
       setPermission('denied');
       return null;
     }
     try {
       const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
       streamRef.current = stream;
       setPermission('granted');
       return stream;
     } catch (err) {
       const mapped = friendlyMicError(err);
       setMicError(mapped);
       setPermission(mapped.code === 'permission-denied' ? 'denied' : 'prompt');
       return null;
     }
   }
 
   function connectWS() {
     setStatus('connecting');
     let index = 0;
  
     const tryNext = () => {
       if (index >= CANDIDATE_WS_URLS.length) {
         setStatus('disconnected');
         console.error('[WS] All candidates failed:', CANDIDATE_WS_URLS);
         return;
       }
  
       const url = CANDIDATE_WS_URLS[index++];
       const ws = new WebSocket(url);
       wsRef.current = ws;
  
       ws.onopen = () => {
         console.info('[WS] connected:', url);
         setStatus('connected');
         ws.send(JSON.stringify({ type: 'config', language }));
         lastPingRef.current = performance.now();
         ws.send(JSON.stringify({ type: 'ping', t: lastPingRef.current }));
       };
  
       ws.onmessage = (ev: MessageEvent) => { /* ...unchanged... */ };
  
       ws.onclose = (ev) => {
         console.warn('[WS] closed', url, ev.code, ev.reason);
         if (status !== 'connected') tryNext();
         else setStatus('disconnected');
       };
       ws.onerror = (err) => {
         console.error('[WS] error', url, err);
         tryNext();
       };
     };
  
     tryNext();
   }
 
   async function start() {
     if (permission !== 'granted' || !streamRef.current) {
       const stream = await requestMicPermission();
       if (!stream) return;
     }
 
     if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) connectWS();
     if (wsRef.current && wsRef.current.readyState !== WebSocket.OPEN) await sleep(150);
 
     if (!audioCtxRef.current) {
       audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
     }
     const ctx = audioCtxRef.current;

     // make sure the context is running (some browsers start in "suspended")
     await ctx.resume();

     sampleRateRef.current = ctx.sampleRate || 48000;
 
     const workletCode = `
       class PCMProcessor extends AudioWorkletProcessor {
         constructor() { super(); this.port.onmessage = (e)=>{ if(e.data.type==='stop'){ this.stopped=true; } }; }
         process(inputs) {
           if (this.stopped) return false;
           const input = inputs[0];
           if (!input || input.length === 0) return true;
           const ch0 = input[0];
           this.port.postMessage({ type: 'samples', buffer: ch0 });
           return true;
         }
       }
       registerProcessor('pcm-processor', PCMProcessor);
     `;
     if (!workletNodeRef.current) {
       const blob = new Blob([workletCode], { type: 'application/javascript' });
       const url = URL.createObjectURL(blob);
       await ctx.audioWorklet.addModule(url);
       const node = new AudioWorkletNode(ctx, 'pcm-processor');
       workletNodeRef.current = node;
       node.port.onmessage = (e: MessageEvent) => {
         if (e.data?.type !== 'samples') return;
         const f32: Float32Array = e.data.buffer;
         const down = downsampleTo24kHz(f32, sampleRateRef.current);
         
         // append to pending
         const prev = pendingSamplesRef.current;
         if (prev && prev.length > 0) {
           const merged = new Float32Array(prev.length + down.length);
           merged.set(prev, 0);
           merged.set(down, prev.length);
           pendingSamplesRef.current = merged;
         } else {
           pendingSamplesRef.current = down;
         }

         // if we have >=100ms, flush one chunk
         const buf = pendingSamplesRef.current!;
         if (buf.length >= THRESHOLD_SAMPLES_24K) {
           const i16 = floatToPCM16(down);
           const b64 = base64FromPCM16(i16);
           wsRef.current?.send(JSON.stringify({ type: 'client.audio.append', audio: b64 }));
           pendingSamplesRef.current = null;
         }
       };
       const source = ctx.createMediaStreamSource(streamRef.current as MediaStream);
       source.connect(node);
       node.connect(ctx.destination);
     }
 
     // Live flush every ~1.2s so you get interim/final text while speaking
     if (flushTimerRef.current) window.clearInterval(flushTimerRef.current);
     flushTimerRef.current = window.setInterval(() => {
       try { wsRef.current?.send(JSON.stringify({ type: 'client.flush' })); } catch {}
     }, 1200);
 
     setRecording(true);
   }
 
   function stop() {
     pendingSamplesRef.current = null;
     try { if (flushTimerRef.current) window.clearInterval(flushTimerRef.current); } catch {}
     flushTimerRef.current = null;
     try { workletNodeRef.current?.port.postMessage({ type: 'stop' }); } catch {}
     try { audioCtxRef.current?.close(); } catch {}
     workletNodeRef.current = null;
     audioCtxRef.current = null;
     setRecording(false);
     _setInterim('');
     // Final flush so last chunk is transcribed
     try { wsRef.current?.send(JSON.stringify({ type: 'client.flush' })); } catch {}
   }
 
   function resetTranscript() {
     setFinals([]);
     setLines([]);
     _setInterim('');
   }
 
   const fullText = composeTranscript(finals, interim);
 
   // ---------- Minimal test harness (runs in browser) ----------
   function runTests() {
     const out: string[] = [];
     function assertEq<T>(name: string, actual: T, expected: T) {
       const pass = JSON.stringify(actual) === JSON.stringify(expected);
       out.push(`${pass ? '✅' : '❌'} ${name} :: ${JSON.stringify(actual)} === ${JSON.stringify(expected)}`);
     }
 
     // Compose tests
     assertEq('compose (finals only)', composeTranscript(['hello', 'world'], ''), 'hello world');
     assertEq('compose (with interim)', composeTranscript(['hello'], 'there'), 'hello there');
     assertEq('compose (both empty)', composeTranscript([], ''), '');
 
     // Smoothing tests
     assertEq('smooth keeps longer when new is prefix', smoothInterim('hello wor', 'hello'), 'hello wor');
     assertEq('smooth accepts new when not prefix', smoothInterim('hi the', 'hello'), 'hello');
 
     // PCM conversions
     const f = new Float32Array([1, 0.5, 0, -0.5, -1]);
     const i = floatToPCM16(f);
     assertEq('pcm16 length', i.length, 5);
     assertEq('pcm16 range clamp', Math.max(...Array.from(i)) <= 32767 && Math.min(...Array.from(i)) >= -32768, true);
 
     // Downsample
     const src = new Float32Array(48000); src[0] = 1; // impulse
     const down = downsampleTo24kHz(src, 48000);
     assertEq('downsample length', down.length, 24000);
     
     setTestOutput(out);
   }
 
   const insecure = !isSecureRuntime();
   const showStartDisabled = permission !== 'granted';
   
   if (!mounted) return null;
   
   return (
     <div style={{ fontFamily: 'system-ui, sans-serif', padding: 16, maxWidth: 900, margin: '0 auto' }}>
       <h1 style={{ textAlign: 'center', fontSize: 24, fontWeight: 600, marginBottom: 8 }}>BeyondConversation </h1>
      <h3 style={{ textAlign: 'center', fontSize: 20, fontWeight: 300, marginBottom: 8 }}>Real-time Speech-to-Text Web App powered by OpenAI</h3>
 
       {insecure && (
         <div style={{ padding: 12, border: '1px solid #fca5a5', background: '#fef2f2', color: '#991b1b', borderRadius: 12, marginBottom: 12 }}>
          <strong>Mic requires a secure origin.</strong> Open over <b>HTTPS</b> or use <b>localhost</b>. Current origin: {originText || 'unknown'}
         </div>
       )}
 
       <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
         <select value={language} onChange={(e) => setLanguage(e.target.value)} style={{ padding: '6px 8px' }}>
           <option value="en">English</option>
           <option value="ko">Korean</option>
           <option value="es">Spanish</option>
           <option value="de">German</option>
           <option value="ja">Japanese</option>
         </select>
         <span style={{ opacity: 0.7, fontSize: 12 }}>Mic: {permission}</span>
         <span style={{ opacity: 0.9, fontSize: 12 }}>WS: {status}</span>
         <span style={{ opacity: 0.9, fontSize: 12 }}>{latencyMs !== null ? `~${latencyMs} ms` : 'latency: —'}</span>
         <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
           <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} /> Auto‑scroll
         </label>
       </div>
 
       <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
         <button onClick={requestMicPermission} style={{ padding: '8px 12px' }}>Enable Microphone</button>
         {!recording ? (
           <button onClick={start} style={{ padding: '8px 12px' }} disabled={showStartDisabled} title={showStartDisabled ? 'Enable microphone first' : undefined}>Start</button>
         ) : (
           <button onClick={stop} style={{ padding: '8px 12px' }}>Stop</button>
         )}
         <button onClick={resetTranscript} style={{ padding: '8px 12px' }}>Reset</button>
         <button onClick={() => downloadText(`transcript-${Date.now()}.txt`, fullText)} style={{ padding: '8px 12px' }}>Save .txt (all)</button>
         <button onClick={runTests} style={{ padding: '8px 12px' }}>Run tests</button>
       </div>
 
       {micError && (
         <div style={{ padding: 12, border: '1px solid #fde68a', background: '#fffbeb', color: '#7c2d12', borderRadius: 12, marginBottom: 12 }}>
           <div style={{ fontWeight: 600, marginBottom: 6 }}>Microphone issue: {micError.code}</div>
           <div style={{ marginBottom: 6 }}>{micError.message}</div>
           <ul style={{ marginLeft: 16, listStyle: 'disc' }}>
             <li>Click the <b>🔒</b> icon in the address bar → <b>Site settings</b> → set <b>Microphone: Allow</b>, then reload.</li>
             <li>On macOS: <b>System Settings → Privacy & Security → Microphone</b> → allow your browser.</li>
             <li>Close other apps using the mic (Zoom/Meet/Teams/recorders) and try again.</li>
           </ul>
         </div>
       )}
 
       {/* Real‑time Transcript Pane */}
       <div ref={paneRef} style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 12, background: '#fff', height: 300, overflow: 'auto' }}>
         {lines.map((ln) => (
           <div key={ln.id} style={{ display: 'flex', gap: 8 }}>
             <div style={{ width: 70, textAlign: 'right', opacity: 0.5, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{new Date(ln.ts).toLocaleTimeString()}</div>
             <div style={{ flex: 1 }}>{ln.text}</div>
           </div>
         ))}
         {interim && (
           <div style={{ display: 'flex', gap: 8 }}>
             <div style={{ width: 70, textAlign: 'right', opacity: 0.3, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>…</div>
             <div style={{ flex: 1, opacity: 0.6 }}>{interim}</div>
           </div>
         )}
       </div>
 
       {/* Legacy full paragraph */}
       <div style={{ border: '1px dashed #e5e7eb', borderRadius: 12, padding: 12, background: '#fafafa', marginTop: 10 }}>
         <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 6 }}>Full paragraph (finals + interim)</div>
         <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, fontSize: 16 }}>
           {finals.join(' ') + (interim ? ' ' : '')}
           {interim && <span style={{ opacity: 0.6 }}>{interim}</span>}
         </p>
       </div>
 
       {testOutput.length > 0 && (
         <div style={{ marginTop: 12, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13 }}>
           <div style={{ fontWeight: 600, marginBottom: 4 }}>Test Results</div>
           <ul>
             {testOutput.map((line, i) => (
               <li key={i}>{line}</li>
             ))}
           </ul>
         </div>
       )}
 
       <p style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>
         Tip: Short phrases yield better interim accuracy. You can start/stop anytime.
       </p>
     </div>
   );
 }
 