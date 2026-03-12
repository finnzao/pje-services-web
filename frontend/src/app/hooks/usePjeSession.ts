'use client';

import { useState, useCallback } from 'react';
import type { SessaoPJE, PerfilPJE, EtapaWizard } from '../componentes/pje-download/types';
import { loginPJE, enviar2FA, selecionarPerfil, ApiError } from '../componentes/pje-download/api';

function isSessionExpiredError(err: unknown): boolean {
  if (err instanceof ApiError) {
    if (err.status === 401) return true;
    const data = err.data as any;
    if (data?.error?.code === 'SESSION_EXPIRED') return true;
  }
  return false;
}

function extrairMensagemErro(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 0) return 'Servidor indisponivel.';
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return 'Erro desconhecido.';
}

export function usePjeSession() {
  const [etapa, setEtapa] = useState<EtapaWizard>('login');
  const [sessao, setSessao] = useState<SessaoPJE>({ autenticado: false });
  const [credenciais, setCredenciais] = useState<{ cpf: string; password: string } | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const logout = useCallback(() => {
    setSessao({ autenticado: false }); setCredenciais(null); setEtapa('login'); setErro(null);
  }, []);

  const login = useCallback(async (cpf: string, senha: string) => {
    setCarregando(true); setErro(null);
    try {
      const result = await loginPJE({ cpf, password: senha });
      if (result.needs2FA) {
        setCredenciais({ cpf, password: senha }); setSessao((prev) => ({ ...prev, sessionId: result.sessionId })); setEtapa('2fa');
      } else if (result.user) {
        setSessao({ autenticado: true, sessionId: result.sessionId, usuario: result.user, perfis: result.profiles || [] });
        setCredenciais({ cpf, password: senha }); setEtapa(result.profiles?.length ? 'perfil' : 'download');
      } else { setErro('Falha na autenticacao.'); }
    } catch (err: any) { setErro(extrairMensagemErro(err)); }
    finally { setCarregando(false); }
  }, []);

  const enviar2FACode = useCallback(async (codigo: string) => {
    setCarregando(true); setErro(null);
    try {
      const sid = sessao.sessionId || 'unknown';
      const result = await enviar2FA(sid, codigo);
      if (result.user) {
        setSessao({ autenticado: true, sessionId: result.sessionId || sid, usuario: result.user, perfis: result.profiles || [] });
        setEtapa(result.profiles?.length ? 'perfil' : 'download');
      } else { setErro('Codigo invalido ou expirado.'); }
    } catch (err: any) { setErro(extrairMensagemErro(err)); }
    finally { setCarregando(false); }
  }, [sessao.sessionId]);

  const selecionarPerfilPje = useCallback(async (perfil: PerfilPJE) => {
    setCarregando(true); setErro(null);
    try {
      const sid = sessao.sessionId; if (!sid) { logout(); return; }
      const result = await selecionarPerfil(sid, perfil.indice);
      if (result.tasks) {
        setSessao((prev) => ({ ...prev, perfilSelecionado: perfil, tarefas: result.tasks, tarefasFavoritas: result.favoriteTasks, etiquetas: result.tags }));
        setEtapa('download');
      } else { setErro('Falha ao selecionar perfil.'); }
    } catch (err: any) {
      if (isSessionExpiredError(err)) { logout(); return; }
      setErro(extrairMensagemErro(err));
    } finally { setCarregando(false); }
  }, [sessao.sessionId, logout]);

  return { etapa, setEtapa, sessao, credenciais, carregando, erro, setErro, login, enviar2FACode, selecionarPerfilPje, logout };
}
