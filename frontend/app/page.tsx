"use client";

import { useEffect, useRef, useState } from "react";

export default function Home() {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [status, setStatus] = useState("Not connected");
  const [source, setSource] = useState<"mic" | "tab" | null>(null);
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [summary, setSummary] = useState("");

  const lastSummarizedRef = useRef("");
  const transcriptRef = useRef("");
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

  const startTranscriptionFromStream = async (stream: MediaStream) => {
    setTranscript("");
    setSummary("");
    lastSummarizedRef.current = "";
    setStatus("Connecting...");

    const ws = new WebSocket(process.env.NEXT_PUBLIC_WS_URL!);
    wsRef.current = ws;

    ws.onopen = async () => {
      setStatus("Connected. Preparing audio...")
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
    setSource(null);
  };

  const startTabTranscription  = async () => {
    setSource("tab");

    const displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    const audioTrack = displayStream.getAudioTracks()[0];

    if (!audioTrack) {
      alert("No audio found. Please select a browser tab and enable 'Share tab audio'.");
      return;
    }

    const audioOnlyStream = new MediaStream([audioTrack]);

    await startTranscriptionFromStream(audioOnlyStream);
  };

  const startMicTranscription = async ()  => {
    setSource("mic");
    const micStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
    });

    await startTranscriptionFromStream(micStream);
  };

  const summarizeTranscript = async (currentTranscript: string) => {
    if (currentTranscript.length < 200) return;
    if (currentTranscript === lastSummarizedRef.current) return;
    
    lastSummarizedRef.current = currentTranscript;

    const res = await fetch("http://localhost:8787/api/summarize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        transcript: currentTranscript,
      }),
    });

    const data = await res.json();
    setSummary(data.summary);
  };

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  useEffect(() => {
    if (!isRecording) return;

    // Every 15 seconds, send transcript and get summary
    const intervalId = setInterval(() => {
      summarizeTranscript(transcriptRef.current);
    }, 15000);

    return () => clearInterval(intervalId);
  }, [isRecording]);

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
          <p className="text-sm text-gray-400 mb-2">Live Transcript</p>
          <p className="whitespace-pre-wrap leading-7 text-gray-100">
            {transcript || "Start speaking or play audio to see the transcript here."}
            {isRecording && transcript &&(
              <span className="ml-1 animate-pulse text-gray-400">|</span>
            )}
          </p>
        </div>
        <div className="mb-6 rounded-lg bg-gray-800 p-4 min-h-32">
          <p className="text-sm text-gray-400 mb-2">Live Summary</p>
          <p className="whitespace-pre-wrap leading-7">
            {summary || "Summary will appear as the transcript grows..."}
          </p>
        </div>

        <div className="flex gap-4 justify-center">
          {!isRecording ? (
            <>
              <button 
                onClick={() => {
                  setSource("mic");
                  setShowPermissionModal(true);
                }}
                className="p-4 border border-gray-800 rounded-md hover:bg-gray-800"
              >
                Use Microphone
              </button>
              <button 
                onClick={() => {
                  setSource("tab");
                  setShowPermissionModal(true);
                }}
                className="p-4 border border-gray-800 rounded-md hover:bg-gray-800"
              >
                Capture YouTube / Tab Audio
              </button>
            </>
            ):(
            <button 
              onClick={stopRecording}
              className="p-4 border border-gray-800 rounded-md hover:bg-gray-800"
            >
              Stop Transcribing
            </button>
          )}
        </div>
        <div className="mb-4 text-sm">
          {isRecording && source === "mic" && (
            <p className="text-red-400">🔴 Recording from microphone...</p>
          )}
          {isRecording && source === "tab" && (
            <p className="text-red-400">🔴 Capturing tab audio...</p>
          )}
        </div>
      </div>
      {showPermissionModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center">
          <div className="bg-gray-900 p-6 rounded-xl w-[320px]">
            <h3 className="text-lg font-semibold mb-2">
              {source === "mic" ? "Use Microphone" : "Capture YouTube / Tab Audio"}
            </h3>

            <p className="text-sm text-gray-400 mb-4">
              {source === "mic"
                ? "We’ll use your microphone to transcribe speech in real time."
                : "Select a tab and turn on 'Share tab audio' to transcribe audio."}
            </p>

            <div className="flex justify-end gap-2">
              <button 
                onClick={() => setShowPermissionModal(false)}
                className="p-2 border border-gray-800 rounded-md hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowPermissionModal(false);
                  source === "mic"
                    ? startMicTranscription()
                    : startTabTranscription();
                }}
                className="p-2 border border-gray-800 rounded-md hover:bg-gray-800"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
