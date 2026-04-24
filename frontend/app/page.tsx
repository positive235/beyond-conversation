"use client";

import { useRef, useState } from "react";

export default function Home() {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [status, setStatus] = useState("Not connected");

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
    let binary = "";
    const bytes = new Uint8Array(buffer);

    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }

    return btoa(binary);
  };

  const startRecording = async () => {
    setTranscript("");
    setStatus("Connecting...");

    const ws = new WebSocket(process.env.NEXT_PUBLIC_WS_URL!);
    wsRef.current = ws;

    ws.onopen = async () => {
      setStatus("Connected. Requesting microphone...");

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true
      });

      streamRef.current = stream;

      const audioContext = new AudioContext({
        sampleRate: 24000
      });

      audioContextRef.current = audioContext;

      await audioContext.audioWorklet.addModule("/pcm-processor.js");

      const source = audioContext.createMediaStreamSource(stream);
      const processor = new AudioWorkletNode(audioContext, "pcm-processor");

      processor.port.onmessage = (event) => {
        if (ws.readyState !== WebSocket.OPEN) return;

        const base64Audio = arrayBufferToBase64(event.data);

        ws.send(
          JSON.stringify({
            type: "audio",
            audio: base64Audio
          })
        );
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      setIsRecording(true);
      setStatus("Recording...");
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === "status") {
        setStatus(data.message);
      }

      if (data.type === "transcript.delta") {
        setTranscript((prev) => prev + data.text);
      }

      if (data.type === "transcript.completed") {
        setTranscript((prev) => {
          if (prev.endsWith(data.text)) return prev;
          return prev + " " + data.text;
        });
      }

      if (data.type === "error") {
        setStatus(`Error: ${data.message}`);
      }
    };

    ws.onerror = () => {
      setStatus("WebSocket error");
    };

    ws.onclose = () => {
      setStatus("Disconnected");
      setIsRecording(false);
    };
  };

  const stopRecording = () => {
    wsRef.current?.send(JSON.stringify({ type: "stop" }));

    streamRef.current?.getTracks().forEach((track) => track.stop());
    audioContextRef.current?.close();

    wsRef.current?.close();

    setIsRecording(false);
    setStatus("Stopped");
  };

  return (
    <main className="min-h-screen bg-gray-950 text-white flex items-center justify-center p-6">
      <div className="w-full max-w-2xl rounded-2xl bg-gray-900 p-8 shadow-xl">
        <h1 className="text-3xl font-bold mb-2">
          BeyondConversation
        </h1>

        <p className="text-gray-400 mb-6">
          Real-Time Speech-to-Text Powered by OpenAI
        </p>

        <div className="mb-4 rounded-lg bg-gray-800 p-4">
          <p className="text-sm text-gray-400">Status</p>
          <p className="text-lg">{status}</p>
        </div>

        <div className="mb-6 rounded-lg bg-gray-800 p-4 min-h-40">
          <p className="text-sm text-gray-400 mb-2">Transcript</p>
          <p className="whitespace-pre-wrap leading-7">
            {transcript || "Your speech will appear here..."}
          </p>
        </div>

        <div className="flex gap-4">
          {!isRecording ? (
            <button
              onClick={startRecording}
              className="rounded-lg bg-blue-600 px-5 py-3 font-semibold hover:bg-blue-500"
            >
              Start Recording
            </button>
          ) : (
            <button
              onClick={stopRecording}
              className="rounded-lg bg-red-600 px-5 py-3 font-semibold hover:bg-red-500"
            >
              Stop Recording
            </button>
          )}
        </div>
      </div>
    </main>
  );
}