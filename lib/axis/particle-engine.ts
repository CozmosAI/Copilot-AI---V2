
export type AxisMode = 'listening' | 'speaking' | 'processing' | 'idle';

interface Particle {
  x: number;
  y: number;
  angle: number;
  orbitRadiusX: number;
  orbitRadiusY: number;
  speed: number;
  size: number;
  opacity: number;
  offset: number; // Para movimento "noise"
}

export class ParticleEngine {
  private ctx: CanvasRenderingContext2D;
  private width: number;
  private height: number;
  private particles: Particle[] = [];
  private mode: AxisMode = 'idle';
  private animationFrameId: number | null = null;

  // Configurações visuais por estado
  private colors = {
    listening: { primary: '#247AAE', secondary: '#3b82f6', line: 'rgba(36, 122, 174, 0.15)' },
    speaking: { primary: '#f59e0b', secondary: '#d97706', line: 'rgba(245, 158, 11, 0.15)' },
    processing: { primary: '#ffffff', secondary: '#94a3b8', line: 'rgba(255, 255, 255, 0.1)' },
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
      this.particles.push({
        x: this.width / 2,
        y: this.height / 2,
        angle: Math.random() * Math.PI * 2,
        orbitRadiusX: 100 + Math.random() * (this.width / 2.5),
        orbitRadiusY: 60 + Math.random() * (this.height / 3),
        speed: (0.002 + Math.random() * 0.005) * (Math.random() < 0.5 ? 1 : -1),
        size: 1 + Math.random() * 2,
        opacity: 0.3 + Math.random() * 0.7,
        offset: Math.random() * 100
      });
    }
  }

  public updateDimensions(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.initParticles(); // Reinicia para ajustar órbitas
  }

  public setMode(mode: AxisMode) {
    this.mode = mode;
  }

  private drawConnections() {
    const activeColor = this.colors[this.mode].line;
    this.ctx.lineWidth = 0.5;
    this.ctx.strokeStyle = activeColor;

    for (let i = 0; i < this.particles.length; i++) {
      for (let j = i + 1; j < this.particles.length; j++) {
        const dx = this.particles[i].x - this.particles[j].x;
        const dy = this.particles[i].y - this.particles[j].y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 60) {
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
    
    // Acelera ou desacelera baseado no modo
    const speedMultiplier = this.mode === 'speaking' ? 2.5 : this.mode === 'processing' ? 4.0 : 1.0;
    const centerX = this.width / 2;
    const centerY = this.height / 2;

    // Atualiza e desenha partículas
    this.particles.forEach(p => {
      // Atualiza ângulo (órbita)
      p.angle += p.speed * speedMultiplier;

      // Movimento elíptico com ruído orgânico
      const noiseX = Math.sin(p.angle * 3 + p.offset) * 10;
      const noiseY = Math.cos(p.angle * 2 + p.offset) * 10;

      p.x = centerX + Math.cos(p.angle) * p.orbitRadiusX + noiseX;
      p.y = centerY + Math.sin(p.angle) * p.orbitRadiusY + noiseY;

      // Desenha
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
    if (!this.animationFrameId) {
      this.animate();
    }
  }

  public stop() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }
}
