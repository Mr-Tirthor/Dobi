/**
 * Personal AI Assistant Voice Pipeline (Node.js)
 *
 * Combines Cloud Neural Text-to-Speech (TTS), Speech-to-Text (STT),
 * automatic offline fallback (`say`), and cross-platform speaker playback:
 *
 *   1. Primary Voice (`@google-cloud/text-to-speech`) -> Natural Neural2/Studio voices + SSML
 *   2. Automatic Offline Fallback (`say`) -> Instant local OS voice when offline or unconfigured
 *   3. Free Prototype Fallback (`gtts`) -> Saves MP3 without an API key
 *   4. Assistant Ears (`@google-cloud/speech`) -> File & live microphone streaming STT
 *   5. Cross-Platform Speaker Playback -> Plays generated audio on Windows, macOS, and Linux
 *
 * Setup:
 *   npm init -y
 *   npm install @google-cloud/text-to-speech @google-cloud/speech say gtts dotenv
 *
 * Optional (for live microphone streaming into @google-cloud/speech):
 *   npm install node-record-lpcm16
 *
 * Run Interactive Assistant Loop:
 *   node text_to_speech.js
 *
 * Or pass a single phrase to speak immediately:
 *   node text_to_speech.js "Good morning! Here is your schedule for today."
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const readline = require('readline');
const { execFile } = require('child_process');

// Load environment variables from .env if dotenv is installed
try {
  require('dotenv').config();
} catch (_) {
  // dotenv is optional
}

// ---------------------------------------------------------------------------
// 1. Primary Engine: Google Cloud Neural Text-to-Speech
//    Supports plain text or SSML (e.g., <speak>Hello <break time="400ms"/> world!</speak>)
// ---------------------------------------------------------------------------
async function generateAudioWithGoogleCloudTTS(text, outputPath, options = {}) {
  let textToSpeech;
  try {
    textToSpeech = require('@google-cloud/text-to-speech');
  } catch (err) {
    throw new Error(
      'Missing "@google-cloud/text-to-speech". Install via: npm install @google-cloud/text-to-speech'
    );
  }

  const client = new textToSpeech.TextToSpeechClient();
  const isSSML = text.trim().startsWith('<speak>');

  const request = {
    input: isSSML ? { ssml: text } : { text },
    voice: {
      languageCode: options.languageCode || 'en-US',
      name: options.voiceName || 'en-US-Neural2-F',
      ssmlGender: options.ssmlGender || 'FEMALE',
    },
    audioConfig: {
      audioEncoding: options.audioEncoding || 'MP3',
      speakingRate: options.speakingRate || 1.0,
      pitch: options.pitch || 0.0,
    },
  };

  const [response] = await client.synthesizeSpeech(request);
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  await fsp.writeFile(outputPath, response.audioContent, 'binary');
  return outputPath;
}

// ---------------------------------------------------------------------------
// 2. Offline Fallback Engine: Native OS Voice (`say`)
//    Speaks immediately through speakers OR exports to a .wav file
// ---------------------------------------------------------------------------
async function speakOfflineWithSay(text, voice = null, speed = 1.0) {
  let say;
  try {
    say = require('say');
  } catch (err) {
    throw new Error('Missing "say" module. Install via: npm install say');
  }

  // Strip basic SSML tags if falling back from an SSML prompt
  const cleanText = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  return new Promise((resolve, reject) => {
    say.speak(cleanText, voice, speed, (err) => {
      if (err) {
        return reject(new Error(`Offline "say.speak" failed: ${err.message}`));
      }
      resolve();
    });
  });
}

async function generateAudioWithSay(text, outputPath, voice = null, speed = 1.0) {
  let say;
  try {
    say = require('say');
  } catch (err) {
    throw new Error('Missing "say" module. Install via: npm install say');
  }

  const cleanText = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });

  return new Promise((resolve, reject) => {
    say.export(cleanText, voice, speed, outputPath, (err) => {
      if (err) {
        return reject(new Error(`"say" export failed: ${err.message}`));
      }
      resolve(outputPath);
    });
  });
}

// ---------------------------------------------------------------------------
// 3. Free No-Key MP3 Fallback: `gtts`
// ---------------------------------------------------------------------------
async function generateAudioWithGTTS(text, outputPath, language = 'en') {
  let gTTS;
  try {
    gTTS = require('gtts');
  } catch (err) {
    throw new Error('Missing "gtts" module. Install via: npm install gtts');
  }

  const cleanText = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });

  return new Promise((resolve, reject) => {
    const speech = new gTTS(cleanText, language);
    speech.save(outputPath, (err) => {
      if (err) {
        return reject(new Error(`gTTS failed to save audio: ${err.message}`));
      }
      resolve(outputPath);
    });
  });
}

// ---------------------------------------------------------------------------
// 4. Cross-Platform Speaker Playback for Saved Audio Files (.mp3 / .wav)
// ---------------------------------------------------------------------------
function playAudioFile(filePath) {
  return new Promise((resolve, reject) => {
    const platform = process.platform;

    if (platform === 'darwin') {
      execFile('afplay', [filePath], (err) => (err ? reject(err) : resolve()));
    } else if (platform === 'win32') {
      // Use Windows MediaPlayer via PowerShell so both .mp3 and .wav work natively
      const psScript = `
        Add-Type -AssemblyName presentationCore;
        $player = New-Object system.windows.media.mediaplayer;
        $player.open('${filePath.replace(/'/g, "''")}');
        $player.Play();
        Start-Sleep -Seconds 1;
        while ($player.NaturalDuration.HasTimeSpan -and $player.Position -lt $player.NaturalDuration.TimeSpan) {
          Start-Sleep -Milliseconds 200;
        }
      `;
      execFile('powershell', ['-NoProfile', '-Command', psScript], (err) =>
        err ? reject(err) : resolve()
      );
    } else {
      // Linux: try ffplay, mpg123, or aplay
      execFile(
        'sh',
        [
          '-c',
          `(command -v ffplay >/dev/null 2>&1 && ffplay -nodisp -autoexit -loglevel quiet "$1") || ` +
            `(command -v mpg123 >/dev/null 2>&1 && mpg123 -q "$1") || ` +
            `(command -v aplay >/dev/null 2>&1 && aplay -q "$1")`,
          '--',
          filePath,
        ],
        (err) => (err ? reject(err) : resolve())
      );
    }
  });
}

// ---------------------------------------------------------------------------
// 5. Speech-to-Text (STT): File Transcription & Live Microphone Stream
// ---------------------------------------------------------------------------
async function transcribeAudioWithGoogleSTT(audioFilePath, languageCode = 'en-US') {
  let speech;
  try {
    speech = require('@google-cloud/speech');
  } catch (err) {
    throw new Error(
      'Missing "@google-cloud/speech". Install via: npm install @google-cloud/speech'
    );
  }

  const client = new speech.SpeechClient();
  const audioBytes = (await fsp.readFile(audioFilePath)).toString('base64');
  const ext = path.extname(audioFilePath).toLowerCase();

  const request = {
    audio: { content: audioBytes },
    config: {
      encoding: ext === '.wav' ? 'LINEAR16' : 'MP3',
      sampleRateHertz: 24000,
      languageCode,
      enableAutomaticPunctuation: true,
    },
  };

  const [response] = await client.recognize(request);
  return response.results
    .map((result) => result.alternatives[0].transcript)
    .join('\n')
    .trim();
}

/**
 * Streams live microphone audio into Google Cloud Speech-to-Text for a single utterance.
 * Requires `npm install node-record-lpcm16` and `sox` / `rec` installed on your OS.
 */
function listenFromMicrophoneOnce(languageCode = 'en-US', timeoutMs = 8000) {
  const speech = require('@google-cloud/speech');
  const recorder = require('node-record-lpcm16');
  const client = new speech.SpeechClient();

  return new Promise((resolve, reject) => {
    let settled = false;
    const recording = recorder.record({
      sampleRateHertz: 16000,
      threshold: 0,
      verbose: false,
      recordProgram: 'rec',
      silence: '2.0',
    });

    const recognizeStream = client
      .streamingRecognize({
        config: {
          encoding: 'LINEAR16',
          sampleRateHertz: 16000,
          languageCode,
          enableAutomaticPunctuation: true,
        },
        interimResults: false,
        singleUtterance: true,
      })
      .on('error', (err) => {
        if (!settled) {
          settled = true;
          recording.stop();
          reject(err);
        }
      })
      .on('data', (data) => {
        const transcript = data.results?.[0]?.alternatives?.[0]?.transcript;
        if (transcript && !settled) {
          settled = true;
          recording.stop();
          recognizeStream.end();
          resolve(transcript.trim());
        }
      });

    recording.stream().pipe(recognizeStream);

    setTimeout(() => {
      if (!settled) {
        settled = true;
        recording.stop();
        recognizeStream.end();
        resolve('');
      }
    }, timeoutMs);
  });
}

// ---------------------------------------------------------------------------
// 6. PersonalVoiceAssistant Class (Cloud TTS -> Offline `say` -> `gtts` Fallback)
// ---------------------------------------------------------------------------
class PersonalVoiceAssistant {
  constructor(config = {}) {
    this.name = config.name || 'Nova';
    this.languageCode = config.languageCode || 'en-US';
    this.voiceName = config.voiceName || 'en-US-Neural2-F';
    this.speakingRate = config.speakingRate || 1.0;
    this.outputDir = config.outputDir || path.join(__dirname, 'output_audio');
    this.autoPlay = config.autoPlay !== false;
  }

  /**
   * Speaks text with automatic resiliency:
   * 1. Tries Google Cloud Neural TTS (if credentials are configured)
   * 2. Falls back to instant offline OS voice (`say`)
   * 3. Falls back to saving an MP3 via free `gtts`
   */
  async speak(text) {
    const timestamp = Date.now();
    const mp3Path = path.join(this.outputDir, `assistant_${timestamp}.mp3`);

    // Step 1: Attempt Google Cloud Neural TTS if credentials are set
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      try {
        const savedPath = await generateAudioWithGoogleCloudTTS(text, mp3Path, {
          languageCode: this.languageCode,
          voiceName: this.voiceName,
          speakingRate: this.speakingRate,
        });
        console.log(`[${this.name} • Cloud Neural TTS] "${text}"`);
        if (this.autoPlay) {
          await playAudioFile(savedPath);
        }
        return { engine: 'google-cloud-tts', audioPath: savedPath };
      } catch (cloudErr) {
        console.warn(
          `[Warning] Cloud TTS unavailable (${cloudErr.message}). Switching to offline fallback...`
        );
      }
    }

    // Step 2: Attempt instant offline OS voice via `say`
    try {
      console.log(`[${this.name} • Offline OS Voice] "${text}"`);
      if (this.autoPlay) {
        await speakOfflineWithSay(text, null, this.speakingRate);
        return { engine: 'say-live', audioPath: null };
      } else {
        const wavPath = path.join(this.outputDir, `assistant_${timestamp}.wav`);
        const savedWav = await generateAudioWithSay(
          text,
          wavPath,
          null,
          this.speakingRate
        );
        return { engine: 'say-export', audioPath: savedWav };
      }
    } catch (sayErr) {
      console.warn(
        `[Warning] Offline "say" voice unavailable (${sayErr.message}). Falling back to gTTS MP3...`
      );
    }

    // Step 3: Final fallback to free `gtts` MP3 file
    const savedGtts = await generateAudioWithGTTS(
      text,
      mp3Path,
      this.languageCode.split('-')[0]
    );
    console.log(`[${this.name} • gTTS MP3 Saved] "${text}" -> ${savedGtts}`);
    if (this.autoPlay) {
      try {
        await playAudioFile(savedGtts);
      } catch (_) {
        // Ignore playback error if headless environment has no speakers
      }
    }
    return { engine: 'gtts', audioPath: savedGtts };
  }

  /**
   * Generates a sample assistant reply (replace this with an LLM call such as Gemini API)
   */
  async generateReply(userMessage) {
    const normalized = userMessage.toLowerCase().trim();

    if (normalized.includes('time')) {
      return `The current local time is ${new Date().toLocaleTimeString()}.`;
    }
    if (normalized.includes('date') || normalized.includes('day')) {
      return `Today is ${new Date().toLocaleDateString(undefined, {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })}.`;
    }
    if (normalized.includes('hello') || normalized.includes('hi')) {
      return `Hello! I am ${this.name}, your personal AI assistant. How can I help you today?`;
    }
    return `You said: "${userMessage}". Connect my generateReply method to an LLM API to answer anything!`;
  }
}

// ---------------------------------------------------------------------------
// 7. Interactive Assistant CLI Loop
// ---------------------------------------------------------------------------
async function startInteractiveAssistant() {
  const assistant = new PersonalVoiceAssistant({
    name: 'Nova',
    languageCode: 'en-US',
    voiceName: 'en-US-Neural2-F',
  });

  const args = process.argv.slice(2);
  if (args.length > 0) {
    const singlePrompt = args.join(' ').trim();
    await assistant.speak(singlePrompt);
    return;
  }

  console.log('==========================================================');
  console.log(`  ${assistant.name} - Personal AI Assistant Voice Loop`);
  console.log('  Type a message to hear your assistant reply,');
  console.log('  or type "exit" to quit.');
  console.log('==========================================================\n');

  await assistant.speak(
    `Hello! I am ${assistant.name}. What can I help you with?`
  );

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '\nYou > ',
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }
    if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
      await assistant.speak('Goodbye! Have a great day.');
      rl.close();
      return;
    }

    const reply = await assistant.generateReply(input);
    await assistant.speak(reply);
    rl.prompt();
  });
}

if (require.main === module) {
  startInteractiveAssistant().catch((err) => {
    console.error('Assistant Error:', err.message);
  });
}

module.exports = {
  PersonalVoiceAssistant,
  generateAudioWithGoogleCloudTTS,
  speakOfflineWithSay,
  generateAudioWithSay,
  generateAudioWithGTTS,
  transcribeAudioWithGoogleSTT,
  listenFromMicrophoneOnce,
  playAudioFile,
};