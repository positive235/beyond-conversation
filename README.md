# BeyondConversation
Real-time Speech-to-Text Web App powered by OpenAI
- Provides Live Transcript and Live Summary

### Home
<img width="727" height="708" alt="image" src="https://github.com/user-attachments/assets/d261b091-7918-49ed-8558-7a5477a38508" />

### Use Microphone
<img width="727" height="701" alt="image" src="https://github.com/user-attachments/assets/12e88af3-28b1-4f4d-adaf-468b759c94ac" />

<img width="727" height="937" alt="image" src="https://github.com/user-attachments/assets/da82b494-593d-402e-a91e-454a42aebbae" />


### Capturing YouTube / Tab Audio
<img width="727" height="702" alt="image" src="https://github.com/user-attachments/assets/caa5087d-b550-4390-b19f-22ce68f87a9b" />

<img width="727" height="760" alt="image" src="https://github.com/user-attachments/assets/f42712a8-5bc2-415f-aa15-ebfe07cf704e" />


## Author
Hae Ji Park (positive235@gmail.com)

## Tech Stack
- Frontend: Next.js, React.js, TypeScript, Tailwind CSS
- Backend: Node.js, Express, WebSocket server
- AI: OpenAI API 

## How to Run
- Create .env file in backend/ folder (Don't share this)
    ```
    OPENAI_API_KEY=your_openai_api_key_here
    PORT=8787
    ```
- Create .env.local file in frontend/ folder (Don't share this)
    ```
    NEXT_PUBLIC_WS_URL=ws://localhost:8787
    ```
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
- Open: `http://localhost:3000`
