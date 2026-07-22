import React, { useState, useEffect } from 'react';
import { CheckCircle2, AlertCircle, Loader2, LogOut, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { apiFetch, safeJsonResponse } from '../../services/apiClient';
import { MercadoLivreLogo } from '../icons/CustomLogos';

export const MercadoLivreIcon = MercadoLivreLogo;

interface MercadoLivreCardProps {
  showToast?: (message: string, type: 'success' | 'error' | 'warning' | 'info', description?: string) => void;
  onStatusChange?: () => void;
}

export function MercadoLivreCard({ showToast, onStatusChange }: MercadoLivreCardProps) {
  const [status, setStatus] = useState<'loading' | 'disconnected' | 'connected' | 'expired'>('loading');
  const [nickname, setNickname] = useState<string>('');
  const [loadingAction, setLoadingAction] = useState<boolean>(false);
  const [localToasts, setLocalToasts] = useState<{ id: string; message: string; type: 'success' | 'error' }[]>([]);

  const triggerToast = (message: string, type: 'success' | 'error', description?: string) => {
    if (showToast) {
      showToast(message, type, description);
    } else {
      const id = Date.now().toString();
      setLocalToasts(prev => [...prev, { id, message, type }]);
      setTimeout(() => {
        setLocalToasts(prev => prev.filter(t => t.id !== id));
      }, 5000);
    }
  };

  const checkStatus = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setStatus('disconnected');
        return;
      }

      const response = await apiFetch('/api/ml/status', {
        headers: {
          'Authorization': `Bearer ${session.access_token}`
        }
      });
      
      if (response.ok) {
        const data = await safeJsonResponse(response);
        if (data.connected) {
          setStatus('connected');
          setNickname(data.nickname || '');
        } else if (data.status === 'expired') {
          setStatus('expired');
          setNickname(data.nickname || '');
        } else {
          setStatus('disconnected');
        }
      } else {
        setStatus('disconnected');
      }
    } catch (error) {
      console.error('Erro ao verificar status Mercado Livre:', error);
      setStatus('disconnected');
    }
  };

  useEffect(() => {
    checkStatus();

    // Parse URL queries for connection success/error status
    const params = new URLSearchParams(window.location.search);
    const mlParam = params.get('ml');
    const mlConnectedParam = params.get('ml_connected');
    const mlErrorParam = params.get('ml_error');

    if (mlParam === 'connected' || mlConnectedParam === 'true') {
      triggerToast('Mercado Livre conectado!', 'success', 'Sua loja foi vinculada com sucesso.');
      // Cleanup parameters safely
      const url = new URL(window.location.href);
      url.searchParams.delete('ml');
      url.searchParams.delete('ml_connected');
      window.history.replaceState({}, document.title, url.pathname + url.search);
      checkStatus();
      if (onStatusChange) onStatusChange();
    } else if (mlParam === 'error' || mlErrorParam) {
      const errorMsg = mlErrorParam || 'Falha ao conectar';
      triggerToast('Falha ao conectar', 'error', errorMsg);
      // Cleanup parameters safely
      const url = new URL(window.location.href);
      url.searchParams.delete('ml');
      url.searchParams.delete('ml_error');
      window.history.replaceState({}, document.title, url.pathname + url.search);
    }
  }, []);

  const handleConnect = async () => {
    setLoadingAction(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        triggerToast('Sessão expirada', 'error', 'Faça login novamente.');
        setLoadingAction(false);
        return;
      }

      const response = await apiFetch('/api/auth/ml', {
        headers: {
          'Authorization': `Bearer ${session.access_token}`
        }
      });

      if (response.ok) {
        const data = await safeJsonResponse(response);
        if (data.authUrl) {
          window.location.href = data.authUrl;
        } else {
          throw new Error('URL de autorização não retornada pelo servidor.');
        }
      } else {
        const data = await safeJsonResponse(response);
        throw new Error(data.error || 'Erro ao gerar URL de autenticação');
      }
    } catch (err: any) {
      triggerToast('Erro de Conexão', 'error', err.message);
      setLoadingAction(false);
    }
  };

  const handleDisconnect = async () => {
    setLoadingAction(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        triggerToast('Sessão expirada', 'error', 'Faça login novamente.');
        setLoadingAction(false);
        return;
      }

      const response = await apiFetch('/api/ml/disconnect', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`
        }
      });

      if (response.ok) {
        triggerToast('Mercado Livre desconectado!', 'success');
        setStatus('disconnected');
        setNickname('');
        if (onStatusChange) onStatusChange();
      } else {
        const data = await safeJsonResponse(response);
        throw new Error(data.error || 'Erro ao desconectar');
      }
    } catch (err: any) {
      triggerToast('Erro ao desconectar', 'error', err.message);
    } finally {
      setLoadingAction(false);
    }
  };

  return (
    <div className={`bg-white p-6 rounded-3xl border shadow-sm flex flex-col group transition-all relative ${
      status === 'connected' ? 'border-emerald-100 ring-1 ring-emerald-50' : 
      status === 'expired' ? 'border-amber-100 ring-1 ring-amber-50' : 
      'border-slate-200 hover:border-navy'
    }`}>
      {/* Floating notifications for fallback mode */}
      {!showToast && localToasts.length > 0 && (
        <div className="fixed top-4 right-4 z-50 pointer-events-none space-y-2 max-w-xs w-full animate-in fade-in">
          {localToasts.map(t => (
            <div
              key={t.id}
              className={`pointer-events-auto p-4 rounded-xl border shadow-xl flex gap-3 items-start ${
                t.type === 'error' ? 'bg-rose-50 border-rose-100 text-rose-800' : 'bg-emerald-50 border-emerald-100 text-emerald-800'
              }`}
            >
              <div className="mt-0.5 shrink-0">
                {t.type === 'error' ? <AlertCircle className="text-rose-500" size={16} /> : <CheckCircle2 className="text-emerald-500" size={16} />}
              </div>
              <div className="text-xs font-bold leading-normal">{t.message}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-between items-start mb-4">
        <div className="w-14 h-14 bg-slate-50 border border-slate-100 rounded-2xl group-hover:bg-navy group-hover:border-navy group-hover:text-white transition-colors flex items-center justify-center shrink-0">
          <MercadoLivreIcon size={38} />
        </div>
        {status === 'loading' ? (
          <span className="text-[9px] font-black text-slate-300 bg-slate-50 px-2 py-1 rounded-full uppercase border border-slate-100 flex items-center gap-1">
            <Loader2 size={10} className="animate-spin" /> Verificando
          </span>
        ) : status === 'connected' ? (
          <span className="flex items-center gap-1 text-[9px] font-black text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full uppercase border border-emerald-100">
            <CheckCircle2 size={10} /> Conectado
          </span>
        ) : status === 'expired' ? (
          <span className="flex items-center gap-1 text-[9px] font-black text-amber-600 bg-amber-50 px-2 py-1 rounded-full uppercase border border-amber-150">
            <AlertCircle size={10} /> Expirado
          </span>
        ) : (
          <span className="text-[9px] font-black text-slate-300 bg-slate-50 px-2 py-1 rounded-full uppercase border border-slate-100">
            Inativo
          </span>
        )}
      </div>

      <h3 className="font-black text-navy text-sm uppercase tracking-widest">Mercado Livre</h3>
      <p className="text-[10px] text-slate-400 mt-1 mb-4 h-8 leading-normal">
        Sincronize pedidos, perguntas e métricas da sua loja do Mercado Livre.
      </p>

      {status === 'connected' ? (
        <div className="mt-auto space-y-3">
          <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-xl flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold text-emerald-800">Sincronização Ativa</p>
              {nickname && <p className="text-[9px] text-emerald-600 truncate max-w-[150px] font-bold">@{nickname}</p>}
            </div>
          </div>
          <button 
            onClick={handleConnect} 
            disabled={loadingAction}
            className="w-full py-2 flex items-center justify-center gap-2 text-[10px] font-bold uppercase text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded-xl transition-all"
          >
            <RefreshCw size={12} className={loadingAction ? 'animate-spin' : ''} /> Trocar Conta
          </button>
          <button 
            onClick={handleDisconnect} 
            disabled={loadingAction}
            className="w-full py-2 flex items-center justify-center gap-2 text-[10px] font-black uppercase text-rose-500 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all"
          >
            <LogOut size={12} /> Desconectar
          </button>
        </div>
      ) : status === 'expired' ? (
        <div className="mt-auto space-y-3">
          <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl">
            <p className="text-[10px] font-bold text-amber-800">Sua conexão expirou</p>
            {nickname && <p className="text-[9px] text-amber-600 truncate font-semibold">@{nickname}</p>}
          </div>
          <button 
            onClick={handleConnect} 
            disabled={loadingAction}
            className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest transition-all flex items-center justify-center gap-2 shadow-lg shadow-amber-500/10"
          >
            {loadingAction ? <Loader2 size={14} className="animate-spin" /> : 'Reconectar'}
          </button>
        </div>
      ) : (
        <button 
          onClick={handleConnect} 
          disabled={status === 'loading' || loadingAction} 
          className={`mt-auto w-full py-3 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${
            loadingAction || status === 'loading'
              ? 'bg-slate-100 text-slate-400' 
              : 'bg-navy text-white hover:bg-slate-800 shadow-lg shadow-navy/20'
          }`}
        >
          {loadingAction ? <Loader2 size={14} className="animate-spin" /> : 'Conectar Mercado Livre'}
        </button>
      )}
    </div>
  );
}
