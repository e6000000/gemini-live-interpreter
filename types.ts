export enum LanguageMode {
  AUTO_TO_GERMAN = 'Auto -> German',
  EN_TO_DE = 'English -> German',
  DE_TO_EN = 'German -> English',
}

export interface AudioDevice {
  deviceId: string;
  label: string;
}

export interface LiveClientConfig {
  micDeviceId?: string;
  speakerDeviceId?: string;
  languageMode: LanguageMode;
  onVolumeChange: (type: 'input' | 'output', volume: number) => void;
}