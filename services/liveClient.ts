import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { LanguageMode } from '../types';
import { pcmToGeminiBlob, base64ToUint8Array, decodeAudioData } from '../utils/audioUtils';

// Define the sink ID type for AudioContext (experimental feature)
interface AudioContextWithSinkId extends AudioContext {
  setSinkId(deviceId: string): Promise<void>;
  sinkId: string;
}

export class LiveClient {
  private ai: GoogleGenAI;
  private inputContext: AudioContext | null = null;
  private outputContext: AudioContextWithSinkId | null = null;
  private stream: MediaStream | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private nextStartTime = 0;
  private currentSession: Promise<any> | null = null; // Storing the promise
  private active = false;
  private onVolumeChange: ((type: 'input' | 'output', volume: number) => void) | null = null;
  private inputAnalyser: AnalyserNode | null = null;
  private outputAnalyser: AnalyserNode | null = null;
  private cleanupFrame: number | null = null;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  }

  private getSystemInstruction(mode: LanguageMode): string {
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
    }

    return `${baseInstruction}\n\n${specificTask}`;
  }

  async connect(config: { micDeviceId?: string; speakerDeviceId?: string; languageMode: LanguageMode, onVolumeChange: (type: 'input' | 'output', v: number) => void }) {
    this.active = true;
    this.onVolumeChange = config.onVolumeChange;
    
    // 1. Setup Audio Contexts
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    this.inputContext = new AudioContext({ sampleRate: 16000 });
    this.outputContext = new AudioContext({ sampleRate: 24000 }) as AudioContextWithSinkId;

    // 2. Configure Output Device (if supported)
    if (config.speakerDeviceId && typeof this.outputContext.setSinkId === 'function') {
      try {
        await this.outputContext.setSinkId(config.speakerDeviceId);
      } catch (e) {
        console.warn('Failed to set output device', e);
      }
    }

    // 3. Setup Analysers
    this.inputAnalyser = this.inputContext.createAnalyser();
    this.inputAnalyser.fftSize = 64; // Small for performance
    this.inputAnalyser.smoothingTimeConstant = 0.5;
    this.outputAnalyser = this.outputContext.createAnalyser();
    this.outputAnalyser.fftSize = 64;
    this.outputAnalyser.smoothingTimeConstant = 0.5;

    this.startVolumeMonitoring();

    // 4. Get Input Stream
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: config.micDeviceId ? { exact: config.micDeviceId } : undefined,
        channelCount: 1,
        sampleRate: 16000,
      }
    });

    // 5. Connect to Gemini Live
    this.currentSession = this.ai.live.connect({
      model: 'gemini-2.5-flash-native-audio-preview-09-2025',
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: this.getSystemInstruction(config.languageMode),
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
    this.scriptProcessor = this.inputContext.createScriptProcessor(4096, 1, 1);
    
    // Connect for analysis
    this.sourceNode.connect(this.inputAnalyser!);
    
    // Connect for processing
    this.sourceNode.connect(this.scriptProcessor);
    this.scriptProcessor.connect(this.inputContext.destination);

    this.scriptProcessor.onaudioprocess = (e) => {
      if (!this.active) return;
      
      const inputData = e.inputBuffer.getChannelData(0);
      const blob = pcmToGeminiBlob(inputData, 16000);
      
      this.currentSession?.then(session => {
         session.sendRealtimeInput({ media: blob });
      });
    };
  }

  private async handleMessage(message: LiveServerMessage) {
    if (!this.outputContext) return;

    // Handle Audio Output
    const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
    if (base64Audio) {
      try {
        const audioData = base64ToUint8Array(base64Audio);
        const audioBuffer = await decodeAudioData(audioData, this.outputContext, 24000);
        
        this.queueAudio(audioBuffer);
      } catch (error) {
        console.error("Error decoding audio", error);
      }
    }

    // Handle Interruption
    if (message.serverContent?.interrupted) {
      this.nextStartTime = this.outputContext.currentTime;
    }
  }

  private queueAudio(buffer: AudioBuffer) {
    if (!this.outputContext || !this.outputAnalyser) return;

    const now = this.outputContext.currentTime;
    if (this.nextStartTime < now) {
      this.nextStartTime = now + 0.05; 
    }

    const source = this.outputContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.outputAnalyser); // Route through analyser
    this.outputAnalyser.connect(this.outputContext.destination);
    
    source.start(this.nextStartTime);
    this.nextStartTime += buffer.duration;
  }

  private startVolumeMonitoring() {
    const dataArray = new Uint8Array(64);
    
    const update = () => {
      if (!this.active) return;

      if (this.inputAnalyser && this.onVolumeChange) {
        this.inputAnalyser.getByteTimeDomainData(dataArray);
        let max = 0;
        // Integer-based loop to find max deviation from 128 (silence)
        for(let i=0; i<64; i++) {
           let val = dataArray[i] - 128; 
           if (val < 0) val = -val;
           if (val > max) max = val;
        }
        // Normalize to 0-1 for UI
        this.onVolumeChange('input', max / 128);
      }

      if (this.outputAnalyser && this.onVolumeChange) {
        this.outputAnalyser.getByteTimeDomainData(dataArray);
        let max = 0;
        for(let i=0; i<64; i++) {
           let val = dataArray[i] - 128;
           if (val < 0) val = -val;
           if (val > max) max = val;
        }
        this.onVolumeChange('output', max / 128);
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

    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect();
      this.scriptProcessor.onaudioprocess = null;
      this.scriptProcessor = null;
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