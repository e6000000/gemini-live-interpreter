import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { LanguageMode } from '../types';
import { pcmToGeminiBlob } from '../utils/audioUtils';

// Define the sink ID type for AudioContext (experimental feature)
interface AudioContextWithSinkId extends AudioContext {
  setSinkId(deviceId: string): Promise<void>;
  sinkId: string;
}

// 1. INPUT WORKLET: Handles Microphone Stream (Audio Thread)
const inputWorkletCode = `
class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 2048;
    this.buffer = new Float32Array(this.bufferSize);
    this.index = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input && input.length > 0) {
      const channel = input[0];
      for (let i = 0; i < channel.length; i++) {
        this.buffer[this.index++] = channel[i];
        if (this.index >= this.bufferSize) {
          this.port.postMessage(this.buffer);
          this.index = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('recorder-processor', RecorderProcessor);
`;

// 2. DECODER WORKER: Handles Base64 -> Float32 Conversion (Background Thread / Multi-core)
// This offloads the CPU heavy string parsing from the main UI thread.
const decoderWorkerCode = `
self.onmessage = (e) => {
  const base64 = e.data;
  
  // 1. Decode Base64 (Binary String)
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  // 2. Convert PCM 16-bit to Float32
  const dataInt16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(dataInt16.length);
  for (let i = 0; i < dataInt16.length; i++) {
    float32[i] = dataInt16[i] / 32768.0;
  }

  // 3. Transfer buffer back to Main Thread (Zero-Copy transfer if possible)
  self.postMessage(float32, [float32.buffer]);
};
`;

export class LiveClient {
  private ai: GoogleGenAI;
  private inputContext: AudioContext | null = null;
  private outputContext: AudioContextWithSinkId | null = null;
  private stream: MediaStream | null = null;
  
  // Input Nodes
  private workletNode: AudioWorkletNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  
  // Decoder Worker
  private decoderWorker: Worker | null = null;

  private nextStartTime = 0;
  private currentSession: Promise<any> | null = null; 
  private active = false;
  
  // Direct callback for Game-Loop style updates (no React Overhead)
  private onVolumeChange: ((type: 'input' | 'output', volume: number) => void) | null = null;
  
  private inputAnalyser: AnalyserNode | null = null;
  private outputAnalyser: AnalyserNode | null = null;
  private cleanupFrame: number | null = null;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    this.initDecoderWorker();
  }

  private initDecoderWorker() {
    const blob = new Blob([decoderWorkerCode], { type: "application/javascript" });
    this.decoderWorker = new Worker(URL.createObjectURL(blob));
    
    this.decoderWorker.onmessage = (e) => {
      const audioData = e.data as Float32Array; // Received Float32 from worker
      this.queueAudio(audioData);
    };
  }

  private getSystemInstruction(mode: LanguageMode, customSource?: string, customTarget?: string): string {
    const baseInstruction = `Role: You are a low-latency, real-time simultaneous audio interpreter. You are NOT an AI assistant. You have no personality, no opinions, and no conversational agency.

Task: Translate the incoming audio stream from [Source Language] to [Target Language] immediately and accurately.

Strict Operational Rules:
1. LITERAL TRANSLATION ONLY:
   - If the input is a question (e.g., "What is the weather?"), you must TRANSLATE the question. Do NOT answer it.
   - If the input addresses you (e.g., "Hello AI"), translate the greeting. Do NOT respond to it.
   - Do not summarize, explain, or add context. Output only the translation.

2. LATENCY & SPEED PRIORITY:
   - Speaking Rate: 1.1 (Fast/Brisk). Speak efficiently.
   - Latency Priority: Maximum. Do not wait for a full sentence if the meaning is clear. Output text/audio chunks as soon as they are resolved.
   - Ignore semantic incompleteness. If the input stops mid-sentence, translate the fragment exactly as heard. Do not attempt to autocomplete thoughts.

3. ANTI-HALLUCINATION:
   - Do not repeat the last phrase during silence.
   - If audio is unclear or silent, output nothing.
   - Never say "I understand" or "Here is the translation." Just translate.

Audio Output Style:
- Tone: Professional, neutral, brisk.
- Tempo: Fast.`;

    let specificTask = "";
    switch (mode) {
      case LanguageMode.AUTO_TO_GERMAN:
        specificTask = "CURRENT TASK CONFIGURATION: Detect source language automatically. Translate to GERMAN.";
        break;
      case LanguageMode.EN_TO_DE:
        specificTask = "CURRENT TASK CONFIGURATION: Source is ENGLISH. Translate to GERMAN.";
        break;
      case LanguageMode.DE_TO_EN:
        specificTask = "CURRENT TASK CONFIGURATION: Source is GERMAN. Translate to ENGLISH.";
        break;
      case LanguageMode.DE_TO_THAI:
        specificTask = "CURRENT TASK CONFIGURATION: Source is GERMAN. Translate to THAI.";
        break;
      case LanguageMode.THAI_TO_DE:
        specificTask = "CURRENT TASK CONFIGURATION: Source is THAI. Translate to GERMAN.";
        break;
      case LanguageMode.KOR_TO_DE:
        specificTask = "CURRENT TASK CONFIGURATION: Source is KOREAN. Translate to GERMAN.";
        break;
      case LanguageMode.CUSTOM:
        const src = customSource || "Detected Language";
        const tgt = customTarget || "English";
        specificTask = `CURRENT TASK CONFIGURATION: Source is ${src}. Translate to ${tgt}.`;
        break;
    }

    return `${baseInstruction}\n\n${specificTask}`;
  }

  async connect(config: { micDeviceId?: string; speakerDeviceId?: string; languageMode: LanguageMode; customSource?: string; customTarget?: string; onVolumeChange: (type: 'input' | 'output', v: number) => void }) {
    this.active = true;
    this.onVolumeChange = config.onVolumeChange;
    
    // 1. Setup Audio Contexts
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    this.inputContext = new AudioContext({ sampleRate: 16000 });
    this.outputContext = new AudioContext({ sampleRate: 24000 }) as AudioContextWithSinkId;

    // Load Input AudioWorklet
    try {
      const blob = new Blob([inputWorkletCode], { type: "application/javascript" });
      const workletUrl = URL.createObjectURL(blob);
      await this.inputContext.audioWorklet.addModule(workletUrl);
    } catch (e) {
      console.error("Failed to load audio worklet", e);
      // Try to clean up if failed
      this.stop();
      throw e;
    }

    // Safety check: stop() might have been called while awaiting addModule
    if (!this.active || !this.inputContext || !this.outputContext) {
      return;
    }

    // 2. Configure Output Device
    if (config.speakerDeviceId && typeof this.outputContext.setSinkId === 'function') {
      try {
        await this.outputContext.setSinkId(config.speakerDeviceId);
      } catch (e) {
        console.warn('Failed to set output device', e);
      }
    }

    // 3. Setup Analysers
    this.inputAnalyser = this.inputContext.createAnalyser();
    this.inputAnalyser.fftSize = 64; 
    this.inputAnalyser.smoothingTimeConstant = 0.5;
    this.outputAnalyser = this.outputContext.createAnalyser();
    this.outputAnalyser.fftSize = 64;
    this.outputAnalyser.smoothingTimeConstant = 0.5;

    this.startVolumeMonitoring();

    // 4. Get Input Stream
    try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: config.micDeviceId ? { exact: config.micDeviceId } : undefined,
            channelCount: 1,
            sampleRate: 16000,
            echoCancellation: true, // Critical for simultaneous use
            autoGainControl: true,
            noiseSuppression: true
          }
        });
    } catch (e) {
        console.error("Failed to get user media", e);
        this.stop();
        throw e;
    }

    // Safety check: stop() might have been called while awaiting getUserMedia
    if (!this.active || !this.inputContext) {
      this.stop(); // Ensure cleanup
      return;
    }

    // 5. Connect to Gemini Live
    this.currentSession = this.ai.live.connect({
      model: 'gemini-2.5-flash-native-audio-preview-09-2025',
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: this.getSystemInstruction(config.languageMode, config.customSource, config.customTarget),
      },
      callbacks: {
        onopen: () => {
          console.log('Gemini Live Connected');
          this.startAudioStreaming();
        },
        onmessage: (msg) => this.handleMessage(msg),
        onclose: () => {
          console.log('Gemini Live Closed');
          this.stop(); 
        },
        onerror: (e) => {
          console.error('Gemini Live Error', e);
        }
      }
    });
  }

  private startAudioStreaming() {
    if (!this.inputContext || !this.stream || !this.currentSession) return;

    this.sourceNode = this.inputContext.createMediaStreamSource(this.stream);
    
    // Connect to Worklet
    this.workletNode = new AudioWorkletNode(this.inputContext, 'recorder-processor');
    this.workletNode.port.onmessage = (event) => {
      if (!this.active) return;
      
      const inputData = event.data;
      const blob = pcmToGeminiBlob(inputData, 16000);
      
      this.currentSession?.then(session => {
         session.sendRealtimeInput({ media: blob });
      });
    };

    // Connect Analysis (Main Thread)
    this.sourceNode.connect(this.inputAnalyser!);
    
    // Connect Processing (Audio Thread)
    this.sourceNode.connect(this.workletNode);
    this.workletNode.connect(this.inputContext.destination);
  }

  private handleMessage(message: LiveServerMessage) {
    if (!this.outputContext) return;

    // Do NOT stop audio on interruption to allow simultaneous output
    if (message.serverContent?.interrupted) {
       // logic removed
    }

    const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
    if (base64Audio) {
      // Send to Worker for parallel processing
      this.decoderWorker?.postMessage(base64Audio);
    }
  }

  // Called when Worker finishes decoding
  private queueAudio(float32Data: Float32Array) {
    if (!this.outputContext || !this.outputAnalyser) return;

    const buffer = this.outputContext.createBuffer(1, float32Data.length, 24000);
    buffer.copyToChannel(float32Data, 0);

    const now = this.outputContext.currentTime;
    // Gapless scheduling
    this.nextStartTime = Math.max(this.nextStartTime, now);

    const source = this.outputContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.outputAnalyser); 
    this.outputAnalyser.connect(this.outputContext.destination);
    
    source.start(this.nextStartTime);
    this.nextStartTime += buffer.duration;

    // Automatic Garbage Collection
    source.onended = () => {
      source.disconnect();
    };
  }

  private startVolumeMonitoring() {
    const dataArray = new Uint8Array(64);
    
    const update = () => {
      if (!this.active) return;

      if (this.inputAnalyser && this.onVolumeChange) {
        this.inputAnalyser.getByteTimeDomainData(dataArray);
        // Standard RMS calculation
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
            const x = (dataArray[i] - 128) / 128.0;
            sum += x * x;
        }
        const rms = Math.sqrt(sum / dataArray.length);
        // Boost factor for visibility
        this.onVolumeChange('input', Math.min(1, rms * 4)); 
      }

      if (this.outputAnalyser && this.onVolumeChange) {
        this.outputAnalyser.getByteTimeDomainData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
            const x = (dataArray[i] - 128) / 128.0;
            sum += x * x;
        }
        const rms = Math.sqrt(sum / dataArray.length);
        this.onVolumeChange('output', Math.min(1, rms * 4));
      }

      this.cleanupFrame = requestAnimationFrame(update);
    };
    update();
  }

  async stop() {
    this.active = false;
    
    if (this.cleanupFrame) {
      cancelAnimationFrame(this.cleanupFrame);
      this.cleanupFrame = null;
    }

    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }

    if (this.inputContext) {
      await this.inputContext.close();
      this.inputContext = null;
    }

    if (this.outputContext) {
      await this.outputContext.close();
      this.outputContext = null;
    }
    
    if (this.currentSession) {
        this.currentSession.then(session => {
            if (typeof session.close === 'function') {
                session.close();
            }
        }).catch(() => {});
        this.currentSession = null;
    }
  }
}