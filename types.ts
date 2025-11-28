export enum LanguageMode {
  AUTO_TO_GERMAN = 'Auto -> German',
  EN_TO_DE = 'English -> German',
  DE_TO_EN = 'German -> English',
  DE_TO_THAI = 'German -> Thai',
  THAI_TO_DE = 'Thai -> German',
  KOR_TO_DE = 'Korean -> German',
  CUSTOM = 'Custom / More...',
}

export interface AudioDevice {
  deviceId: string;
  label: string;
}

export interface LiveClientConfig {
  micDeviceId?: string;
  speakerDeviceId?: string;
  languageMode: LanguageMode;
  customSource?: string;
  customTarget?: string;
  onVolumeChange: (type: 'input' | 'output', volume: number) => void;
}
