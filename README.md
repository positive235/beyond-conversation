# BeyondConversation
**Real-time Speech-to-Text Web App powered by OpenAI**

## Overview
**BeyondConversation** is a real-time speech-to-text web application that provides **live transcription** and **AI-powered summarization** from both microphone input and browser tab audio (e.g., YouTube).
It helps users stay engaged in conversations without needing to manually take notes.

## Motivation
This project was inspired by a friend with partial hearing loss after an accident.

In everyday situations-especially in noisy environments or fast-paced conversations-it can be difficult to fully follow what’s being said.

**BeyondConversation** was built to:

- Improve accessibility in real-time communication
- Help users better understand spoken content
- Reduce the cognitive load of listening and remembering

## Features

- Real-time speech-to-text transcription
- Real-time AI-powered summarization
- Tab audio capture (e.g., YouTube)
- Live updates via WebSocket
- Clean, responsive UI

## Screenshots
### Home
<img width="727" height="708" alt="image" src="https://github.com/user-attachments/assets/d261b091-7918-49ed-8558-7a5477a38508" />

### Use Microphone
<img width="727" height="701" alt="image" src="https://github.com/user-attachments/assets/12e88af3-28b1-4f4d-adaf-468b759c94ac" />

<img width="727" height="937" alt="image" src="https://github.com/user-attachments/assets/da82b494-593d-402e-a91e-454a42aebbae" />


### Capturing YouTube / Tab Audio
<img width="727" height="702" alt="image" src="https://github.com/user-attachments/assets/caa5087d-b550-4390-b19f-22ce68f87a9b" />

<img width="727" height="760" alt="image" src="https://github.com/user-attachments/assets/f42712a8-5bc2-415f-aa15-ebfe07cf704e" />


## Tech Stack
- Frontend: Next.js, React.js, TypeScript, Tailwind CSS
- Backend: Node.js, Express, WebSocket server
- AI: OpenAI API 

## How to Run
1. Clone this repository

2. Install dependencies with `npm install` 

3. Set Environment variables
- Create .env file in backend/ folder (Don't share this)
    ```
    OPENAI_API_KEY=your_openai_api_key_here
    PORT=8787
    ```
- Create .env.local file in frontend/ folder (Don't share this)
    ```
    NEXT_PUBLIC_WS_URL=ws://localhost:8787
    ```

4. Run the app
- backend: 
    ```
    cd backend
    npm run dev
    ```
- frontend:
    ```
    cd frontend
    npm run dev
    ```

5. Open in browser
- Open: `http://localhost:3000`

## Author
Hae Ji Park (https://www.linkedin.com/in/hjp123/)
