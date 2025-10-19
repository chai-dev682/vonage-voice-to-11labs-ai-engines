'use strict'

//-------------

require('dotenv').config();

//--
const express = require('express');
const bodyParser = require('body-parser')
const webSocket = require('ws');
const app = express();
require('express-ws')(app);

app.use(bodyParser.json());

const fsp = require('fs').promises;
const moment = require('moment');

//---- CORS policy - Update this section as needed ----

app.use(function (req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  res.header("Access-Control-Allow-Methods", "OPTIONS,GET,POST,PUT,DELETE");
  res.header("Access-Control-Allow-Headers", "Content-Type, Access-Control-Allow-Headers, Authorization, X-Requested-With");
  next();
});

//-------

const servicePhoneNumber = process.env.SERVICE_PHONE_NUMBER;
console.log('------------------------------------------------------------');
console.log("You may call in to the phone number:", servicePhoneNumber);
console.log('------------------------------------------------------------');

//--- Vonage API ---

const { Auth } = require('@vonage/auth');

const credentials = new Auth({
  apiKey: process.env.API_KEY,
  apiSecret: process.env.API_SECRET,
  applicationId: process.env.APP_ID,
  privateKey: './.private.key'    // private key file name with a leading dot 
});

const apiRegion = "https://" + process.env.API_REGION;

const options = {
  apiHost: apiRegion
};

const { Vonage } = require('@vonage/server-sdk');

const vonage = new Vonage(credentials, options);

//-- For call leg recording --

const fs = require('fs');
// const request = require('request');
const axios = require('axios');

const appId = process.env.APP_ID; // used by tokenGenerate
const privateKey = fs.readFileSync('./.private.key'); // used by tokenGenerate
const { tokenGenerate } = require('@vonage/jwt');

const region = process.env.API_REGION.substring(4, 6);
// console.log("region:", region);
const apiBaseUrl = "https://api-" + region +".vonage.com";
// console.log("apiBaseUrl:", apiBaseUrl);

//--- Streaming timer - Audio packets to Vonage ---

// const timer = 19; // in ms, actual timer duration is higher
const timer = 18; // in ms, actual timer duration is higher

//---- ElevenLabs TTS engine ----

const elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
const elevenLabsAgentId = process.env.ELEVENLABS_AGENT_ID;

//-------------------

let recordCalls = false;
if (process.env.RECORD_CALLS == 'true') {
  recordCalls = true
}

//---- Custom settings ---
const maxCallDuration = process.env.MAX_CALL_DURATION; // in seconds

console.log('------------------------------------------------------------');
console.log('To manually trigger an outbound PSTN call to a phone number,');
console.log('in a web browser, enter the address:');
console.log('https://<this-application-server-address>/call?number=<number>');
console.log("<number> must in E.164 format without '+' sign, or '-', '.' characters");
console.log('for example');
console.log('https://xxxx.ngrok.xxx/call?number=12995551212');
console.log('------------------------------------------------------------');

//--- Streaming timer calculation ---

let prevTime = Date.now();
let counter = 0;
let total = 0;
let cycles = 2000;

console.log('\n>>> Wait around', Math.round(cycles * timer / 1000), 'seconds to see the actual streaming timer average ...\n');

const streamTimer = setInterval ( () => {
    
    const timeNow = Date.now();
    const difference = timeNow - prevTime;
    total = total + difference;
    prevTime = timeNow;

    counter++;

    if (counter == cycles) { 
        clearInterval(streamTimer);
        console.log('\n>>> Average streaming timer (should be close to 20 AND under 20.000):', total / counter);
    };

}, timer);

//--- Websocket server (for Websockets from Vonage Voice API platform) ---

app.ws('/socket', async (ws, req) => {

  //-- debug only --
  let ttsSeq = 0;

  //-----

  const peerUuid = req.query.peer_uuid;
  
  const webhookUrl = req.query.webhook_url;
  console.log('>>> webhookUrl:', webhookUrl);
  
  let elevenLabsTimer;

  console.log('>>> WebSocket from Vonage platform')
  console.log('>>> peer call uuid:', peerUuid);

  let wsVgOpen = true; // WebSocket to Vonage ready for binary audio payload?

  // let startSpeech = false;
  
  let dropTtsChunks = false;
  
  // let newResponseStart = '';  // first sentence of OpenAI new streamed responsse

  //-- audio recording files -- 
  const audioTo11lFileName = './recordings/' + peerUuid + '_rec_to_11l_' + moment(Date.now()).format('YYYY_MM_DD_HH_mm_ss_SSS') + '.raw'; // using local time
  const audioToVgFileName = './recordings/' + peerUuid + '_rec_to_vg_' + moment(Date.now()).format('YYYY_MM_DD_HH_mm_ss_SSS') + '.raw'; // using local time

  if (recordCalls) { 

    try {
      await fsp.writeFile(audioTo11lFileName, '');
    } catch(e) {
      console.log("Error creating file", audioTo11lFileName, e);
    }
    console.log('File created:', audioTo11lFileName);

    try {
      await fsp.writeFile(audioToVgFileName, '');
    } catch(e) {
      console.log("Error creating file", audioToVgFileName, e);
    }
    console.log('File created:', audioToVgFileName);

  }

//-- stream audio to VG --

  let payloadToVg = Buffer.alloc(0);
  let streamToVgIndex = 0;
  let lastTime = Date.now();
  let nowTime;

  //-

  const streamTimer = setInterval ( () => {

    if (payloadToVg.length != 0) {

      const streamToVgPacket = Buffer.from(payloadToVg).subarray(streamToVgIndex, streamToVgIndex + 640);  // 640-byte packet for linear16 / 16 kHz
      streamToVgIndex = streamToVgIndex + 640;

      if (streamToVgPacket.length != 0) {
        if (wsVgOpen && streamToVgPacket.length == 640) {
            nowTime = Date.now();
            
            // console.log('>> interval:', nowTime - lastTime, 's');
            process.stdout.write(".");
            
            ws.send(streamToVgPacket);
            lastTime = nowTime;

            if (recordCalls) {
              try {
                fsp.appendFile(audioToVgFileName, streamToVgPacket, 'binary');
              } catch(error) {
                console.log("error writing to file", audioToVg2FileName, error);
              }
            }  

        };
      } else {
        streamToVgIndex = streamToVgIndex - 640; // prevent index from increasing for ever as it is beyond buffer current length
      }

    } 

  }, timer);

  //-- ElevenLabs connection ---

  let ws11LabsOpen = false; // WebSocket to ElevenLabs ready for binary audio payload?

  const elevenLabsWsUrl = "wss://api.elevenlabs.io/v1/convai/conversation?agent_id=" + elevenLabsAgentId;

  const elevenLabsWs = new webSocket(elevenLabsWsUrl, {
    headers: { "xi-api-key": elevenLabsApiKey },
  });

  //--

  elevenLabsWs.on('error', async (event) => {
    console.log('>>> ElevenLabs WebSocket error:', event);
  }); 

  //--

  elevenLabsWs.on('open', async () => {
    console.log('>>> WebSocket to ElevenLabs opened');

    // const initMessage = {
    //     "type": "conversation_initiation_client_data",
    //     "conversation_config_override": {
    //       "agent": {
    //         "prompt": {
    //           "prompt": "You are a helpful assistant."
    //         },
    //         "first_message": "Hi, I'm Aria from ElevenLabs support. How can I help you today?",
    //         "language": "en"
    //       },
    //       "tts": {
    //         "voice_id": elevenLabsVoiceId
    //       }
    //     }
    //     // "custom_llm_extra_body": {
    //     //   "temperature": 0.7,
    //     //   "max_tokens": 150
    //     // },
    //     // "dynamic_variables": {
    //     //   "user_name": "John",
    //     //   "account_type": "premium"
    //     // }
    //   };

    // ws.send(JSON.stringify(initMessage));
    
    ws11LabsOpen = true;

  });

  //--
      
  elevenLabsWs.on('message', async(msg) =>  {

    const data = JSON.parse(msg.toString());

    switch(data.type) {

    case 'audio':

      const newAudioPayloadToVg = Buffer.from(data.audio_event.audio_base_64, 'base64');

      console.log('\n>>>', Date.now(), 'Received audio payload from ElevenLabs:', newAudioPayloadToVg.length, 'bytes');

      // if (startSpeech) {
      //   dropTtsChunks = true;
      // }

      if (wsVgOpen) {

        // // console.log('\ndropTtsChunks:', dropTtsChunks);

        // if (dropTtsChunks) {

        //   const textArray = data.alignment.chars;

        //   // take first 15 chars or less
        //   const textLength = Math.min(textArray.length, 15);

        //   let receivedTtsText = '';

        //   for (let i = 0; i < textLength; i++) {
        //     receivedTtsText = receivedTtsText + textArray[i];
        //   }

        //   if (newResponseStart != '') {

        //     const compareLength = Math.min(receivedTtsText.length, newResponseStart.slice(0, textLength).length); // sometimes one string has extra trailing space character

        //     if ( receivedTtsText.slice(0, compareLength) == newResponseStart.slice(0, compareLength) ) {
        //       dropTtsChunks = false;
        //       payloadToVg = Buffer.concat([payloadToVg, newAudioPayloadToVg]);
        //     } 

        //   } 

        // } else {

        payloadToVg = Buffer.concat([payloadToVg, newAudioPayloadToVg]);
      
        // }

      }

      break;

    //---

    case 'user_transcript':

      await axios.post(webhookUrl,  
        {
          "type": 'user_transcript',
          "transcript": data.user_transcription_event.user_transcript,
          "call_uuid": peerUuid
        },
        {
        headers: {
          "Content-Type": 'application/json'
        }
      });

      console.log('\n', data);

      break;

    //---   

    case 'agent_response':

      await axios.post(webhookUrl,  
        {
          "type": 'agent_response',
          "response": data.agent_response_event.agent_response,
          "call_uuid": peerUuid
        },
        {
        headers: {
          "Content-Type": 'application/json'
        }
      });

      console.log('\n', data);

      break;

    //---  

    case 'interruption':
    
      // barge-in
      payloadToVg = Buffer.alloc(0);  // reset stream buffer to VG
      streamToVgIndex = 0;

      console.log('\n', data);

      break;
    
    //---  

    case 'client_tool_call':
      
      // Store the tool call parameters for later use
      const extension = data.client_tool_call.parameters.extension;
      
      console.log('\n', data);

      ws11LabsOpen = false

      // Clean up resources and close WebSocket connections
      clearInterval(streamTimer); // Clear the streaming timer
      if (elevenLabsWs.readyState === webSocket.OPEN) {
        elevenLabsWs.close();
      }
      ws.close();
      
      await axios.post(webhookUrl,  
        {
          "type": 'client_tool_call',
          "extension": extension,
          "call_uuid": peerUuid
        },
        {
        headers: {
          "Content-Type": 'application/json'
        }
      });

      break;

    //---  

    case 'ping':

      // console.log('\n', data);

      if (ws11LabsOpen) {

        elevenLabsWs.send(JSON.stringify({
          type: "pong",
          event_id: data.ping_event.event_id
        }));

        // console.log('replied: { type: "pong", event_id:', data.ping_event.event_id, '}');

      }  

      break;


    //---
  
    
    default:

      console.log('\n', data); 

    }

  });

  //--

  elevenLabsWs.on('close', async (msg) => {

    // clearInterval(elevenLabsTimer);
    
    ws11LabsOpen = false; // stop sending audio payload to 11L platform

    console.log('\n>>> ElevenLabs WebSocket closed')
  
  });

 
  //---------------

  ws.on('message', async (msg) => {
    
    if (typeof msg === "string") {
    
      console.log(">>> Vonage Websocket message:", msg);
    
    } else {

      if (ws11LabsOpen) {

        elevenLabsWs.send(JSON.stringify({
          user_audio_chunk: msg.toString('base64')
        }));

        if (recordCalls) {
          try {
            fsp.appendFile(audioTo11lFileName, msg, 'binary');
          } catch(error) {
            console.log("error writing to file", audioTo11lFileName, error);
          }
        } 
      
      } 

    }

  });

  //--

  ws.on('close', async () => {

    wsVgOpen = false;
    console.log("\n>>> Vonage WebSocket closed");

    clearInterval(streamTimer); // Clean up the streaming timer
    elevenLabsWs.close(); // close WebSocket to ElevenLabs
  });

});

//============= Processing inbound PSTN calls ===============

//-- Incoming PSTN call --

app.get('/answer', async(req, res) => {

  const uuid = req.query.uuid;

  //--

  if (recordCalls) {
    //-- RTC webhooks need to be enabled for this application in the dashboard --
    //-- start "leg" recording --
    const accessToken = tokenGenerate(appId, privateKey, {});
  
    try { 
      // const response = await axios.post(apiRegion + '/v1/legs/' + uuid + '/recording',
      const response = await axios.post(apiBaseUrl + '/v1/legs/' + uuid + '/recording',
        {
          "split": true,
          "streamed": true,
          // "beep": true,
          "public": true,
          "validity_time": 30,
          "format": "mp3",
          // "transcription": {
          //   "language":"en-US",
          //   "sentiment_analysis": true
          // }
        },
        {
          headers: {
            "Authorization": 'Bearer ' + accessToken,
            "Content-Type": 'application/json'
          }
        }
      );
      console.log('\n>>> Start recording on leg:', uuid);
    } catch (error) {
      console.log('\n>>> Error start recording on leg:', uuid, error);
    }

  } 

  //--

  const nccoResponse = [
    {
      "action": "conversation",
      "name": "conf_" + uuid,
      "startOnEnter": true,
      "endOnExit": true
    }
  ];

  res.status(200).json(nccoResponse);

});

//------------

app.get('/event', async(req, res) => {

  res.status(200).send('Ok');

  //--

  const hostName = req.hostname;
  const uuid = req.query.uuid;

  //--

  if (req.query.type == 'transfer') {  // this is when the PSTN leg is effectively connected to the named conference

    //-- Create WebSocket leg --

    // WebSocket connection URI
    // Custom data: participant identified as 'user1' in this example, could be 'agent', 'customer', 'patient', 'doctor', ...
    // PSTN call direction is 'inbound'
    
    const wsUri = 'wss://' + hostName + '/socket?participant=' + 'user1' +'&call_direction=inbound&peer_uuid=' + uuid + '&webhook_url=https://' + hostName + '/results';

    vonage.voice.createOutboundCall({
      to: [{
        type: 'websocket',
        uri: wsUri,
        'content-type': 'audio/l16;rate=16000'  // NEVER change the content-type parameter argument
      }],
      from: {
        type: 'phone',
        number: '12995550101' // value does not matter
      },
      answer_url: ['https://' + hostName + '/ws_answer_1?original_uuid=' + uuid],
      answer_method: 'GET',
      event_url: ['https://' + hostName + '/ws_event_1?original_uuid=' + uuid],
      event_method: 'GET'
      })
      .then(res => {
        console.log("\n>>> WebSocket create status:", res);
      })
      .catch(err => console.error("\n>>> WebSocket create error:", err))  

  };

});

app.post('/event', async(req, res) => {

  res.status(200).send('Ok');

  //--

  const uuid = req.body.uuid;

  console.log('call ended: ', uuid);

});

//--------------

app.get('/ws_answer_1', async(req, res) => {

  const uuid = req.query.original_uuid;

  const nccoResponse = [
    {
      "action": "conversation",
      "name": "conf_" + uuid,
      "startOnEnter": true
    }
  ];

  res.status(200).json(nccoResponse);

 });

//------------

app.post('/ws_event_1', async(req, res) => {

  res.status(200).send('Ok');

});

//============= Initiating outbound PSTN calls ===============

//-- Use case where the PSTN call is outbound
//-- manually trigger outbound PSTN call to "number" - see sample request below
//-- sample request: https://<server-address>/call?number=12995550101

app.get('/call', async(req, res) => {

  if (req.query.number == null) {

    res.status(200).send('"number" parameter missing as query parameter - please check');
  
  } else {

    // code may be added here to make sure the number is in valid E.164 format (without leading '+' sign)
  
    res.status(200).send('Ok');  

    const hostName = req.hostname;

    //-- Outgoing PSTN call --

    vonage.voice.createOutboundCall({
      to: [{
        type: 'phone',
        number: req.query.number
      }],
      from: {
       type: 'phone',
       number: servicePhoneNumber
      },
      limit: maxCallDuration, // limit outbound call duration for demos purposes
      answer_url: ['https://' + hostName + '/answer_2'],
      answer_method: 'GET',
      event_url: ['https://' + hostName + '/event_2'],
      event_method: 'POST'
      })
      .then(res => console.log(">>> Outgoing PSTN call status:", res))
      .catch(err => console.error(">>> Outgoing PSTN call error:", err))

    }

});

//-----------------------------

app.get('/answer_2', async(req, res) => {

  const uuid = req.query.uuid;

  const nccoResponse = [
    {
      "action": "conversation",
      "name": "conf_" + uuid,
      "startOnEnter": true,
      "endOnExit": true
    }
  ];

  res.status(200).json(nccoResponse);

 });

//------------

app.post('/event_2', async(req, res) => {

  res.status(200).send('Ok');

  //--

  const hostName = req.hostname;
  const uuid = req.body.uuid;

  //--

    if (req.body.status == 'ringing' && recordCalls) {  

    const accessToken = tokenGenerate(appId, privateKey, {});

    try { 
      // const response = await axios.post(apiRegion + '/v1/legs/' + uuid + '/recording',
      const response = await axios.post(apiBaseUrl + '/v1/legs/' + uuid + '/recording',
        {
          "split": true,
          "streamed": true,
          "public": true,
          "validity_time": 30,
          "format": "mp3"
        },
        {
          headers: {
            "Authorization": 'Bearer ' + accessToken,
            "Content-Type": 'application/json'
          }
        }
      );
      console.log('\n>>> Start recording on leg:', uuid);
    } catch (error) {
      console.log('\n>>> Error start recording on leg:', uuid, error);
    }

  }

  //--

  if (req.body.type == 'transfer') {  // this is when the PSTN leg is effectively connected to the named conference

    //-- Create WebSocket leg --

    // WebSocket connection URI
    // Custom data: participant identified as 'user1' in this example, could be 'agent', 'customer', 'patient', 'doctor', ...
    // PSTN call direction is 'outbound'
    const wsUri = 'wss://' + hostName + '/socket?participant=' + 'user1' +'&call_direction=outbound&peer_uuid=' + uuid + '&webhook_url=https://' + hostName + '/results';

    vonage.voice.createOutboundCall({
      to: [{
        type: 'websocket',
        uri: wsUri,
        'content-type': 'audio/l16;rate=16000'  // NEVER change the content-type parameter argument
      }],
      from: {
        type: 'phone',
        number: '12995550101' // value does not matter
      },
      answer_url: ['https://' + hostName + '/ws_answer_2?original_uuid=' + uuid],
      answer_method: 'GET',
      event_url: ['https://' + hostName + '/ws_event_2?original_uuid=' + uuid],
      event_method: 'POST'
      })
      .then(res => {
        console.log("\n>>> WebSocket create status:", res);
      })
      .catch(err => console.error("\n>>> WebSocket create error:", err))   

  };

});

//--------------

app.get('/ws_answer_2', async(req, res) => {

  const uuid = req.query.original_uuid;

  const nccoResponse = [
    {
      "action": "conversation",
      "name": "conf_" + uuid,
      "startOnEnter": true
    }
  ];

  res.status(200).json(nccoResponse);

 });

//------------

app.post('/ws_event_2', async(req, res) => {

  res.status(200).send('Ok');

});

//------------

app.post('/results', async(req, res) => {

  // console.log(req.body)
  if (req.body.type == 'client_tool_call') {
    console.log('>>> Transferring call to right agent');
    vonage.voice.createOutboundCall({
      to: [{
        type: 'vbc',
        extension: req.body.extension
      }],
      from: {
        type: 'phone',
        number: '12995550101' // value does not matter
      },
      answer_url: ['https://' + req.hostname + '/ws_answer_3?original_uuid=' + req.body.call_uuid],
      answer_method: 'GET',
      event_url: ['https://' + req.hostname + '/ws_event_3?original_uuid=' + req.body.call_uuid],
      event_method: 'POST'
    })
    .then(res => console.log(">>> Outgoing PSTN call status:", res))
    .catch(err => console.error(">>> Outgoing PSTN call error:", err))
    return;
  }

  res.status(200).send('Ok');

});

app.get('/ws_answer_3', async(req, res) => {
  const ncco = [
    {
      "action": "conversation",
      "name": "conf_" + req.query.original_uuid,
      "startOnEnter": true,
      "endOnExit": true
    }
  ];
  return res.status(200).json(ncco);
});

app.post('/ws_event_3', async(req, res) => {
  res.status(200).send('Ok');
});


//-------------

//-- Retrieve call recordings --
//-- RTC webhook URL set to 'https://<server>/rtc' for this application in the dashboard --

app.post('/rtc', async(req, res) => {

  res.status(200).send('Ok');

  switch (req.body.type) {

    case "audio:record:done": // leg recording, get the audio file
      console.log('\n>>> /rtc audio:record:done');
      console.log('req.body.body.destination_url', req.body.body.destination_url);
      console.log('req.body.body.recording_id', req.body.body.recording_id);

      await vonage.voice.downloadRecording(req.body.body.destination_url, './post-call-data/' + req.body.body.recording_id + '_' + req.body.body.channel.id + '.mp3');
 
      break;

    case "audio:transcribe:done": // leg recording, get the transcript
      console.log('\n>>> /rtc audio:transcribe:done');
      console.log('req.body.body.transcription_url', req.body.body.transcription_url);
      console.log('req.body.body.recording_id', req.body.body.recording_id);

      await vonage.voice.downloadTranscription(req.body.body.transcription_url, './post-call-data/' + req.body.body.recording_id + '.txt');  

      break;      
    
    default:  
      // do nothing

  }

});
 

//--- If this application is hosted on VCR (Vonage Cloud Runtime) serverless infrastructure --------

app.get('/_/health', async(req, res) => {

  res.status(200).send('Ok');

});

//=========================================

const port = process.env.VCR_PORT || process.env.PORT || 8000;

app.listen(port, () => console.log(`\nVoice API application listening on port ${port}`));

//------------
