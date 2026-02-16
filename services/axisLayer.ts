
// ==========================================
// TYPES
// ==========================================
export type AxisMode = 'listening' | 'speaking' | 'processing' | 'idle';

// ==========================================
// PARTICLE ENGINE (CANVAS)
// ==========================================
interface Particle {
  x: number;
  y: number;
  angle: number;
  orbitRadiusX: number;
  orbitRadiusY: number;
  speed: number;
  size: number;
  opacity: number;
  offset: number;
}

export class ParticleEngine {
  private ctx: CanvasRenderingContext2D;
  private width: number;
  private height: number;
  private particles: Particle[] = [];
  private mode: AxisMode = 'idle';
  private animationFrameId: number | null = null;

  private colors = {
    listening: { primary: '#247AAE', secondary: '#3b82f6', line: 'rgba(36, 122, 174, 0.25)' },
    speaking: { primary: '#f59e0b', secondary: '#d97706', line: 'rgba(245, 158, 11, 0.25)' },
    processing: { primary: '#ffffff', secondary: '#94a3b8', line: 'rgba(255, 255, 255, 0.15)' },
    idle: { primary: '#1e293b', secondary: '#0f172a', line: 'rgba(30, 41, 59, 0)' },
  };

  constructor(ctx: CanvasRenderingContext2D, width: number, height: number) {
    this.ctx = ctx;
    this.width = width;
    this.height = height;
    this.initParticles();
  }

  private initParticles() {
    this.particles = [];
    const count = 120;
    
    for (let i = 0; i < count; i++) {
      const baseRadius = 70; 
      const variance = 50;

      this.particles.push({
        x: this.width / 2,
        y: this.height / 2,
        angle: Math.random() * Math.PI * 2,
        orbitRadiusX: baseRadius + Math.random() * variance,
        orbitRadiusY: baseRadius + Math.random() * variance,
        speed: (0.005 + Math.random() * 0.01) * (Math.random() < 0.5 ? 1 : -1),
        size: 1 + Math.random() * 2.5,
        opacity: 0.4 + Math.random() * 0.6,
        offset: Math.random() * 100
      });
    }
  }

  public updateDimensions(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.initParticles();
  }

  public setMode(mode: AxisMode) {
    this.mode = mode;
  }

  private drawConnections() {
    const activeColor = this.colors[this.mode].line;
    this.ctx.lineWidth = 0.5;
    this.ctx.strokeStyle = activeColor;

    for (let i = 0; i < this.particles.length; i++) {
      for (let j = i + 1; j < Math.min(i + 15, this.particles.length); j++) {
        const dx = this.particles[i].x - this.particles[j].x;
        const dy = this.particles[i].y - this.particles[j].y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 50) {
          this.ctx.beginPath();
          this.ctx.moveTo(this.particles[i].x, this.particles[i].y);
          this.ctx.lineTo(this.particles[j].x, this.particles[j].y);
          this.ctx.stroke();
        }
      }
    }
  }

  private animate = () => {
    this.ctx.clearRect(0, 0, this.width, this.height);
    
    const speedMultiplier = this.mode === 'speaking' ? 3.0 : this.mode === 'processing' ? 5.0 : 1.0;
    const centerX = this.width / 2;
    const centerY = this.height / 2;

    this.particles.forEach(p => {
      p.angle += p.speed * speedMultiplier;
      const noiseX = Math.sin(p.angle * 3 + p.offset) * 5;
      const noiseY = Math.cos(p.angle * 2 + p.offset) * 5;

      p.x = centerX + Math.cos(p.angle) * p.orbitRadiusX + noiseX;
      p.y = centerY + Math.sin(p.angle) * p.orbitRadiusY + noiseY;

      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      this.ctx.fillStyle = Math.random() > 0.5 
        ? this.colors[this.mode].primary 
        : this.colors[this.mode].secondary;
      this.ctx.globalAlpha = p.opacity;
      this.ctx.fill();
      this.ctx.globalAlpha = 1.0;
    });

    this.drawConnections();
    this.animationFrameId = requestAnimationFrame(this.animate);
  };

  public start() {
    if (!this.animationFrameId) this.animate();
  }

  public stop() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }
}

// ==========================================
// SPEECH RECOGNITION (Web Speech API)
// ==========================================
export class AxisSpeechRecognizer {
  private recognition: any = null;
  private silenceTimer: any = null;
  private onResult: (text: string, isFinal: boolean) => void;
  private onStatusChange: (isListening: boolean) => void;
  private onSilenceDetected: (finalText: string) => void;
  private onError: (error: string) => void;
  
  private currentTranscript: string = '';
  private isProcessingSilence: boolean = false;
  private shouldBeListening: boolean = false;
  private isRecognizing: boolean = false;

  constructor(
    onResult: (text: string, isFinal: boolean) => void,
    onStatusChange: (isListening: boolean) => void,
    onSilenceDetected: (finalText: string) => void,
    onError?: (error: string) => void
  ) {
    this.onResult = onResult;
    this.onStatusChange = onStatusChange;
    this.onSilenceDetected = onSilenceDetected;
    this.onError = onError || ((e) => console.error(e));

    if (typeof window !== 'undefined') {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = 'pt-BR';
        this.setupListeners();
      } else {
        this.onError('browser-not-supported');
      }
    }
  }

  private setupListeners() {
    if (!this.recognition) return;

    this.recognition.onstart = () => {
      this.isRecognizing = true;
      this.onStatusChange(true);
    };

    this.recognition.onend = () => {
      this.isRecognizing = false;
      this.onStatusChange(false);

      if (this.shouldBeListening) {
          setTimeout(() => {
              if (this.shouldBeListening && !this.isRecognizing) {
                  try {
                      this.recognition.start();
                  } catch (e) {}
              }
          }, 200);
      }
    };

    this.recognition.onresult = (event: any) => {
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
      
      this.resetSilenceTimer();
    };

    this.recognition.onerror = (event: any) => {
      if (event.error === 'no-speech') return;
      if (event.error === 'not-allowed') {
          this.shouldBeListening = false;
          this.isRecognizing = false;
          this.onError('not-allowed');
      }
    };
  }

  private resetSilenceTimer() {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    
    // REDUZIDO PARA 800ms para resposta mais rápida
    this.silenceTimer = setTimeout(() => {
      if (this.currentTranscript.trim().length > 0 && !this.isProcessingSilence) {
        this.isProcessingSilence = true;
        this.onSilenceDetected(this.currentTranscript);
        this.currentTranscript = '';
        setTimeout(() => { this.isProcessingSilence = false; }, 500);
      }
    }, 800); 
  }

  public start() {
    if (!this.recognition) return;
    if (this.isRecognizing) return;

    this.shouldBeListening = true;
    try {
        this.recognition.start();
    } catch (e: any) {
        // Ignora erro se já iniciado
    }
  }

  public stop() {
    this.shouldBeListening = false;
    if (this.recognition) {
        try { this.recognition.abort(); } catch {}
    }
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.isRecognizing = false;
  }
}
