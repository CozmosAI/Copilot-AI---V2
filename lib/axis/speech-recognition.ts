
// Define types that might be missing in some TypeScript environments
interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: ((this: SpeechRecognition, ev: Event) => any) | null;
  onend: ((this: SpeechRecognition, ev: Event) => any) | null;
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => any) | null;
  onerror: ((this: SpeechRecognition, ev: any) => any) | null;
}

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
  error: any;
}

interface SpeechRecognitionResultList {
  length: number;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

type RecognitionCallback = (text: string, isFinal: boolean) => void;
type StatusCallback = (isListening: boolean) => void;
type ErrorCallback = (error: string) => void;

export class AxisSpeechRecognizer {
  private recognition: SpeechRecognition | null = null;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private onResult: RecognitionCallback;
  private onStatusChange: StatusCallback;
  private onSilenceDetected: (finalText: string) => void;
  private onError: ErrorCallback | null = null;
  private currentTranscript: string = '';
  private isProcessingSilence: boolean = false;

  constructor(
    onResult: RecognitionCallback,
    onStatusChange: StatusCallback,
    onSilenceDetected: (finalText: string) => void,
    onError?: ErrorCallback
  ) {
    this.onResult = onResult;
    this.onStatusChange = onStatusChange;
    this.onSilenceDetected = onSilenceDetected;
    this.onError = onError || null;

    if (typeof window !== 'undefined') {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        this.recognition = new SpeechRecognition();
        if (this.recognition) {
            this.recognition.continuous = true;
            this.recognition.interimResults = true;
            this.recognition.lang = 'pt-BR';
            this.setupListeners();
        }
      } else {
        console.error('Web Speech API não suportada neste navegador.');
        if (this.onError) this.onError('browser-not-supported');
      }
    }
  }

  private setupListeners() {
    if (!this.recognition) return;

    this.recognition.onstart = () => {
      this.onStatusChange(true);
    };

    this.recognition.onend = () => {
      this.onStatusChange(false);
      // Reinicia automaticamente se não foi parado manualmente
      // A lógica de controle deve chamar stop() explicitamente se quiser parar
    };

    this.recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }

      const textToShow = finalTranscript || interimTranscript;
      this.currentTranscript = textToShow;
      this.onResult(textToShow, !!finalTranscript);

      // Reseta o timer de silêncio sempre que houver som/resultado
      this.resetSilenceTimer();
    };

    this.recognition.onerror = (event) => {
      console.error('Speech Recognition Error:', event.error);
      if (event.error === 'no-speech') {
        // Ignora erros de "sem fala" e tenta manter ativo
        return;
      }
      
      if (this.onError) {
        this.onError(event.error);
      }
    };
  }

  private resetSilenceTimer() {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    
    // Se temos texto e parou de falar por 1.5s
    this.silenceTimer = setTimeout(() => {
      if (this.currentTranscript.trim().length > 0 && !this.isProcessingSilence) {
        this.isProcessingSilence = true;
        this.onSilenceDetected(this.currentTranscript);
        this.currentTranscript = ''; // Limpa buffer local
        setTimeout(() => { this.isProcessingSilence = false; }, 500); // Debounce
      }
    }, 1500);
  }

  public start() {
    if (this.recognition) {
      try {
        this.recognition.start();
      } catch (e) {
        console.warn('Recognition already started');
      }
    }
  }

  public stop() {
    if (this.recognition) {
      this.recognition.stop();
      if (this.silenceTimer) clearTimeout(this.silenceTimer);
    }
  }

  public toggleMute(shouldMute: boolean) {
    if (shouldMute) {
      this.stop();
    } else {
      this.start();
    }
  }
}
