# Vonage Voice API to ElevenLabs Conversational AI Integration

This Vonage Voice API application connects voice calls directly to ElevenLabs Conversational AI agents, enabling natural voice conversations with AI-powered agents.

Voice calls may be:</br>
inbound/outbound,</br>
PSTN calls (cell phones, landline phones, fixed phones),</br>
SIP calls with [SIP endpoints](https://developer.vonage.com/en/voice/voice-api/concepts/endpoints#session-initiation-protocol-sip) or [Programmable SIP](https://developer.vonage.com/en/voice/voice-api/concepts/programmable-sip),</br>
[WebRTC](https://developer.vonage.com/en/vonage-client-sdk/overview) calls (iOS/Android/Web Javascript clients).</br>

## About this application

This application establishes real-time audio streaming between voice calls and ElevenLabs Conversational AI using the [WebSockets feature](https://developer.vonage.com/en/voice/voice-api/concepts/websockets) of Vonage Voice API.

When a voice call is established, the application:
- Creates a WebSocket connection to ElevenLabs Conversational AI API
- Streams audio bidirectionally between the caller and the AI agent
- Handles transcriptions, agent responses, and interruptions
- Supports call transfer to VBC extensions via client tool calls
- Includes language routing for multi-language support

## Features

- **Real-time Audio Streaming**: Bidirectional audio streaming at 16kHz linear PCM
- **Call Transfer**: Transfer calls to VBC extensions based on AI agent tool calls
- **Language Routing**: Route transfers to language-specific extensions
- **Call Recording**: Optional call leg recording with webhook support
- **Transcriptions**: Receive user transcripts and agent responses via webhook
- **Interruption Handling**: Supports conversation barge-in

## Set up

### Prerequisites

1. **ElevenLabs Account**: Sign up at [ElevenLabs](https://elevenlabs.io) and create a Conversational AI agent
   - Obtain your **ElevenLabs API Key** from your account settings
   - Obtain your **ElevenLabs Agent ID** from your Conversational AI agent configuration

2. **Vonage Account**: [Log in](https://dashboard.nexmo.com/sign-in) or [sign up](https://ui.idp.vonage.com/ui/auth/registration) for a Vonage APIs account

3. **Public Server Access**: For local development, use [ngrok](https://ngrok.com) to expose your local server

### Set up ngrok (for local deployment)

If you plan to test using a `Local deployment`, you'll need ngrok (an Internet tunneling service) to expose your local server.

[Install ngrok](https://ngrok.com/downloads), then log in or sign up with [ngrok](https://ngrok.com/).<br>
From the ngrok web UI menu, follow the **Setup and Installation** guide.

Set up a tunnel to forward to local port 8000 (default port for this application):<br>
```bash
ngrok http 8000
```

Please take note of the ngrok public URL (e.g., `xxxxxxxx.ngrok.xxx`) as it will be needed for your Vonage application webhooks.<br>
The URL should not have a trailing `/`.

### Set up your Vonage Voice API application

1. Go to [Your applications](https://dashboard.nexmo.com/applications), access an existing application or [+ Create a new application](https://dashboard.nexmo.com/applications/new)

2. Under **Capabilities** section (click [Edit] if you do not see this section):

3. **Enable Voice**
   - **Answer URL**: Leave HTTP **GET**, and enter</br>
     `https://<your-server>/answer`</br>
     Example with ngrok: `https://xxxxxxxx.ngrok.xxx/answer`
   
   - **Event URL**: Select HTTP **POST**, and enter</br>
     `https://<your-server>/event`</br>
     Example with ngrok: `https://xxxxxxxx.ngrok.xxx/event`

4. **Enable RTC (In-app voice & messaging)** if you want to use call recording features
   - **RTC Event URL**: Enter</br>
     `https://<your-server>/rtc`</br>
     Example with ngrok: `https://xxxxxxxx.ngrok.xxx/rtc`

5. **Generate Keys**
   - Click [Generate public and private key]
   - Save the private key file in this application folder as `.private.key` (note the leading dot)
   - Click [Generate new application] if you've just created the application
   - **IMPORTANT**: If updating an existing application, click [Save changes]

6. **Link a Phone Number**
   - Link a phone number to this application if none has been linked

7. **Collect Required Credentials**
   - **Application ID** (from the application page)
   - **Phone number** linked to your application
   - **API Key** from [Settings](https://dashboard.nexmo.com/settings)
   - **API Secret** from [Settings](https://dashboard.nexmo.com/settings) (not signature secret)
   - **API Region** - select the region where your application was created (e.g., `api-us-4.vonage.com`)

### Environment Configuration

1. **Copy the example environment file**
```bash
cp .env-example .env
```

2. **Update the `.env` file with your credentials:**

```bash
#==== Vonage API ====
API_KEY=your_vonage_api_key
API_SECRET=your_vonage_api_secret
APP_ID=your_vonage_application_id
SERVICE_PHONE_NUMBER=12995551212  # Your Vonage number (E.164 without '+')

# API Region - uncomment the one matching your application region
API_REGION=api-us-4.vonage.com

#==== Other parameters ====
MAX_CALL_DURATION=300  # Maximum duration for outbound calls (seconds)
RECORD_CALLS=false     # Set to 'true' to enable call recording

#==== ElevenLabs parameters ====
ELEVENLABS_API_KEY=your_elevenlabs_api_key
ELEVENLABS_AGENT_ID=your_elevenlabs_agent_id
```

3. **Place your Vonage private key file**
   - Save your private key as `.private.key` in the application root directory

### Installation and Running

1. **Install Node.js**
   - This application has been tested with Node.js version 22.16
   - Download from [nodejs.org](https://nodejs.org)

2. **Install dependencies**
```bash
npm install
```

3. **Start the application**
```bash
node voice-to-ai-engines
```

The application will start on port **8000** by default (can be changed with `PORT` environment variable).

## Usage

### Making Calls

#### Inbound Calls

Simply call the phone number linked to your Vonage application. The caller will be automatically connected to your ElevenLabs Conversational AI agent.

#### Outbound Calls

To manually trigger an outbound call, open a web browser and enter:

```
https://<server-address>/call?number=<number>
```

- `<number>` must be in E.164 format without leading '+' sign, spaces, '-', or '.' characters
- Example: `https://xxxx.ngrok.xxx/call?number=12995551212`

You can also programmatically initiate outbound calls by making a GET request to the `/call` endpoint.

### Call Transfer to VBC Extensions

Your ElevenLabs Conversational AI agent can transfer calls to Vonage Business Communications (VBC) extensions using client tool calls.

The application supports **language routing**, which automatically routes transfers to language-specific extensions based on the language parameter in the tool call.

#### Default Language Routing Map

```javascript
{
  '8000': {
    'english': '8000',
    'spanish': '8001',
    'french': '8003',
    'russian': '8004',
    'chinese': '316'
  }
}
```

For example, if your AI agent invokes a transfer to extension `8000` with language `spanish`, the call will be routed to extension `8001`.

### Managing Language Routing

You can view and update the language routing map at runtime using the REST API.

#### Get Language Routing Map

```bash
GET /language-routing
```

Returns the current language routing configuration.

#### Update Language Routing Map

```bash
POST /language-routing
Content-Type: application/json

{
  "8000": {
    "english": "8000",
    "spanish": "8001",
    "french": "8003"
  },
  "9000": {
    "english": "9000",
    "spanish": "9001"
  }
}
```

This replaces the entire language routing map with the provided configuration.

### Webhooks and Events

The application sends webhook notifications to `/results` endpoint for the following events:

#### User Transcript
Sent when the user's speech is transcribed:
```json
{
  "type": "user_transcript",
  "transcript": "Hello, I need help",
  "call_uuid": "abc-123-def"
}
```

#### Agent Response
Sent when the AI agent responds:
```json
{
  "type": "agent_response",
  "response": "Hello! How can I assist you today?",
  "call_uuid": "abc-123-def"
}
```

#### Client Tool Call (Transfer Request)
Sent when the agent requests a transfer:
```json
{
  "type": "client_tool_call",
  "extension": "8001",
  "call_uuid": "abc-123-def"
}
```

### Call Recording

When `RECORD_CALLS=true`, the application will:
- Record both legs of the call (split stereo)
- Stream recordings in MP3 format
- Store recordings in `./post-call-data/` directory
- Generate two types of audio files:
  - `_rec_to_11l_*.raw` - Audio sent to ElevenLabs
  - `_rec_to_vg_*.raw` - Audio sent to Vonage (from ElevenLabs)

Recording files are delivered via RTC webhooks to the `/rtc` endpoint.

## API Endpoints

### Voice Webhooks

- `GET /answer` - Answer URL for inbound calls
- `POST /event` - Event URL for call events
- `GET /call?number=<number>` - Trigger outbound call

### WebSocket

- `WS /socket` - WebSocket endpoint for audio streaming (used by Vonage platform)

### Management API

- `GET /language-routing` - Get current language routing map
- `POST /language-routing` - Update language routing map
- `POST /results` - Webhook for transcripts, responses, and transfers
- `POST /rtc` - RTC webhook for call recordings

### Health Check

- `GET /_/health` - Health check endpoint (for VCR deployments)

## Technical Details

### Audio Specifications

- **Sample Rate**: 16 kHz
- **Format**: Linear PCM (16-bit)
- **Packet Size**: 640 bytes per packet (20ms of audio)
- **Streaming Timer**: ~18-20ms intervals for optimal latency

### Architecture

1. **Call Setup**: When a call comes in, the application creates a Vonage conference
2. **WebSocket Creation**: A WebSocket leg is added to the conference, connecting to this application
3. **ElevenLabs Connection**: Application establishes a WebSocket to ElevenLabs Conversational AI
4. **Audio Streaming**: Bidirectional audio flows between caller ↔ Vonage ↔ Application ↔ ElevenLabs
5. **Event Handling**: Transcripts, responses, and tool calls are processed in real-time
6. **Call Transfer**: When agent requests transfer, call is routed to VBC extension with language routing

### Directory Structure

```
vonage-voice-to-11labs-ai-engines/
├── voice-to-ai-engines.js    # Main application
├── package.json               # Dependencies
├── .env                       # Environment variables (create from .env-example)
├── .env-example               # Example environment configuration
├── .private.key               # Vonage private key (generate from dashboard)
├── post-call-data/            # Call recordings (MP3 files)
└── recordings/                # Real-time audio recordings (RAW files, if enabled)
```

Note: The `recordings/` directory needs to be created if `RECORD_CALLS=true`:
```bash
mkdir recordings
```

## Deployment Options

### Local Development
- Use ngrok for public access
- Default port: 8000
- Requires Node.js 22.16+

### Vonage Cloud Runtime (VCR)
- Use the `Procfile` for Heroku-style deployments
- Health check available at `/_/health`
- Set `VCR_PORT` environment variable if needed

### Production Deployment
- Use a process manager (e.g., PM2, systemd)
- Set up proper SSL/TLS certificates
- Configure firewall rules
- Use environment variables for all secrets

## Additional resources

If you have questions, join our [Community Slack](https://developer.vonage.com/community/slack) or message us on [X](https://twitter.com/VonageDev?adobe_mc=MCMID%3D61117212728348884173699984659581708157%7CMCORGID%3DA8833BC75245AF9E0A490D4D%2540AdobeOrg%7CTS%3D1740259490).



