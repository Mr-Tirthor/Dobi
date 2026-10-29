const express = require('express');
const path = require('path');
const fsp = require('fs/promises');
const app = express();
const PORT = process.env.PORT || 1001;



// Import the assistant class and helper functions from text_to_speech.js
const {
  PersonalVoiceAssistant,
  transcribeAudioWithGoogleSTT,
} = require('.//../AI.js');

const AUDIO_OUTPUT_DIR = path.join(__dirname, 'output_audio');

// Middleware to parse JSON and URL-encoded bodies
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve generated audio files statically at http://localhost:3000/audio/<filename>
app.use('/audio', express.static(AUDIO_OUTPUT_DIR));

// Initialize the PersonalVoiceAssistant
// Set `autoPlay: false` on a web server so it returns the audio file to the client
// (Set `autoPlay: true` if your Express server runs on a local Raspberry Pi / desktop speaker)
const assistant = new PersonalVoiceAssistant({
  name: 'Dobi',
  languageCode: 'en-US',
  voiceName: 'en-US-Neural2-F',
  outputDir: AUDIO_OUTPUT_DIR,
  autoPlay: false,
});

// ---------------------------------------------------------------------------
// 1. POST /api/assistant/chat
//    Body: { "message": "What time is it?", "playOnServer": false }
//    Returns: { replyText, engine, audioUrl }
// ---------------------------------------------------------------------------
app.post('/api/assistant/chat', async (req, res) => {
  try {
    const { message, playOnServer = false } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        error: 'Please provide a valid "message" string in the request body.',
      });
    }

    // Temporarily toggle server speaker playback if requested
    assistant.autoPlay = Boolean(playOnServer);

    // 1. Generate the assistant's text response
    const replyText = await assistant.generateReply(message);

    // 2. Synthesize speech audio using the fallback pipeline (Cloud TTS -> say -> gTTS)
    const { engine, audioPath } = await assistant.speak(replyText);

    const audioUrl = audioPath
      ? `/audio/${path.basename(audioPath)}`
      : null;

    return res.json({
      userMessage: message,
      replyText,
      engine,
      audioUrl,
    });
  } catch (err) {
    console.error('[/api/assistant/chat] Error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// 2. POST /api/tts
//    Body: { "text": "Hello from Express!" }
//    Streams the generated .mp3 or .wav audio file directly to the client
// ---------------------------------------------------------------------------
app.post('/api/tts', async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({
        error: 'Please provide a "text" string in the request body.',
      });
    }

    assistant.autoPlay = false;
    const { audioPath } = await assistant.speak(text);

    if (!audioPath) {
      return res.status(500).json({
        error: 'Audio was spoken on the host OS but no file was exported.',
      });
    }

    // Stream the generated audio file directly back to the browser/client
    return res.sendFile(audioPath);
  } catch (err) {
    console.error('[/api/tts] Error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// 3. POST /api/stt
//    Body: { "audioBase64": "<base64-encoded-audio>", "extension": ".mp3" }
//    Transcribes client audio using Speech-to-Text and returns the assistant's spoken reply
// ---------------------------------------------------------------------------
app.post('/api/stt', async (req, res) => {
  try {
    const { audioBase64, extension = '.mp3' } = req.body;

    if (!audioBase64) {
      return res.status(400).json({
        error: 'Please provide "audioBase64" in the request body.',
      });
    }

    await fsp.mkdir(AUDIO_OUTPUT_DIR, { recursive: true });
    const tempInputPath = path.join(
      AUDIO_OUTPUT_DIR,
      `upload_${Date.now()}${extension}`
    );

    // Save incoming base64 audio to disk for transcription
    const audioBuffer = Buffer.from(audioBase64, 'base64');
    await fsp.writeFile(tempInputPath, audioBuffer);

    // 1. Transcribe user audio -> text
    const transcript = await transcribeAudioWithGoogleSTT(
      tempInputPath,
      assistant.languageCode
    );

    // Clean up temporary uploaded file
    await fsp.unlink(tempInputPath).catch(() => {});

    // 2. Generate assistant reply and synthesize response audio
    const replyText = await assistant.generateReply(transcript);
    assistant.autoPlay = false;
    const { engine, audioPath } = await assistant.speak(replyText);

    return res.json({
      transcript,
      replyText,
      engine,
      audioUrl: audioPath ? `/audio/${path.basename(audioPath)}` : null,
    });
  } catch (err) {
    console.error('[/api/stt] Error:', err);
    return res.status(500).json({ error: err.message });
  }
});






app.use(express.json());


app.get('/', (req, res) => {
    res.send('Gandu server mast chale che!!');
});


app.listen(PORT, () => {
    console.log(`Server is running and listening at http://localhost:${PORT}`);
});
