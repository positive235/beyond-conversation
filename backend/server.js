import "dotenv/config";
import express from "express";
import cors from "cors";
import { WebSocketServer, WebSocket } from "ws";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8787;

const server = app.listen(PORT, () => {
    console.log(`[server] listening on http://localhost:${PORT}`);
});

const wss = new WebSocketServer({ server });

wss.on("connection", (clientWs) => {
    console.log("[server] frontend connected");

    const openaiWs = new WebSocket(
        "wss://api.openai.com/v1/realtime?intent=transcription",
        {
            headers: {
                Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
                "OpenAI-Beta": "realtime=v1"
            }
        }
    );

    openaiWs.on("open", () => {
        console.log("[server] connected to OpenAI Realtime");

        openaiWs.send(
            JSON.stringify({
                type: "transcription_session.update",
                session: {
                    input_audio_format: "pcm16",
                    input_audio_transcription: {
                        model: "gpt-4o-mini-transcribe"
                    },
                    turn_detection: {
                        type: "server_vad"
                    }
                }
            })
        );

        clientWs.send(
            JSON.stringify({
                type: "status",
                message: "Connected to OpenAI Realtime API"
            })
        );
    });

    clientWs.on("message", (message) => {
        if (openaiWs.readyState !== WebSocket.OPEN) return;

        const data = JSON.parse(message.toString());

        if (data.type === "audio") {
            openaiWs.send(
                JSON.stringify({
                    type: "input_audio_buffer.append",
                    audio: data.audio
                })
            );
        }

        if (data.type === "stop") {
            openaiWs.send(
                JSON.stringify({
                    type: "input_audio_buffer.commit"
                })
            );
        }
    });

    openaiWs.on("message", (message) => {
        const event = JSON.parse(message.toString());

        if (event.type === "conversation.item.input_audio_transcription.delta") {
            clientWs.send(
                JSON.stringify({
                    type: "transcript.delta",
                    text: event.delta || ""
                })
            );
        }

        if (event.type === "conversation.item.input_audio_transcription.completed") {
            clientWs.send(
                JSON.stringify({
                    type: "transcript.completed",
                    text: event.transcript || ""
                })
            );
        }

        if (event.type === "error") {
            console.error("[OpenAI error]", event.error);
            clientWs.send(
                JSON.stringify({
                    type: "error",
                    message: event.error?.message || "OpenAI error"
                })
            );
        }
    });

    clientWs.on("close", () => {
        console.log("[server] frontend disconnected");
        if (openaiWs.readyState === WebSocket.OPEN) {
            openaiWs.close();
        }
    });

    openaiWs.on("close", () => {
        console.log("[server] OpenAI connection closed");
    });

    openaiWs.on("error", (error) => {
        console.error("[server] OpenAI WebSocket error:", error.message);
    });
});