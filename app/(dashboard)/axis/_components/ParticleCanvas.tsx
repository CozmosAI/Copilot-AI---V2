
'use client';

import { useEffect, useRef } from 'react';
import { ParticleEngine, AxisMode } from '@/lib/axis/particle-engine';

interface ParticleCanvasProps {
  mode: AxisMode;
}

export default function ParticleCanvas({ mode }: ParticleCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<ParticleEngine | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Configuração inicial de tamanho
    const updateSize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      if (engineRef.current) {
        engineRef.current.updateDimensions(canvas.width, canvas.height);
      }
    };

    updateSize();
    window.addEventListener('resize', updateSize);

    // Inicializa Engine
    engineRef.current = new ParticleEngine(ctx, canvas.width, canvas.height);
    engineRef.current.setMode(mode);
    engineRef.current.start();

    return () => {
      window.removeEventListener('resize', updateSize);
      engineRef.current?.stop();
    };
  }, []);

  // Reage a mudanças de modo
  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.setMode(mode);
    }
  }, [mode]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none z-0"
      style={{ background: 'transparent' }}
    />
  );
}
