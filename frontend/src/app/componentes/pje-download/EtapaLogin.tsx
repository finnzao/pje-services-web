'use client';

import React, { useState } from 'react';
import { Lock, Mail, Smartphone, Loader2, AlertCircle } from 'lucide-react';

interface Props {
  carregando: boolean;
  erro: string | null;
  aguardando2FA: boolean;

  twoFactorType?: 'totp' | 'email';
  onLogin: (cpf: string, senha: string) => void;
  onEnviar2FA: (codigo: string) => void;
}

export function EtapaLogin({
  carregando, erro, aguardando2FA, twoFactorType,
  onLogin, onEnviar2FA,
}: Props) {
  const [cpf, setCpf] = useState('');
  const [senha, setSenha] = useState('');
  const [codigo2FA, setCodigo2FA] = useState('');

  const handleSubmitLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cpf.trim() || !senha.trim()) return;
    onLogin(cpf.replace(/\D/g, ''), senha);
  };

  const handleSubmit2FA = (e: React.FormEvent) => {
    e.preventDefault();
    if (!codigo2FA.trim() || codigo2FA.length !== 6) return;
    onEnviar2FA(codigo2FA);
  };

  if (aguardando2FA) {
    const isTotp = twoFactorType === 'totp';
    return (
      <div className="max-w-md mx-auto">
        <div className="border-2 border-slate-200 p-8">
          <div className="flex items-center gap-3 mb-6">
            <div
              className={`w-10 h-10 flex items-center justify-center ${
                isTotp ? 'bg-blue-100' : 'bg-amber-100'
              }`}
            >
              {isTotp
                ? <Smartphone size={20} className="text-blue-700" />
                : <Mail size={20} className="text-amber-700" />}
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">Verificação em 2 etapas</h3>
              <p className="text-sm text-slate-500">
                {isTotp
                  ? 'Abra seu app autenticador'
                  : 'Código enviado para seu email'}
              </p>
            </div>
          </div>

          {isTotp && (
            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 text-xs text-blue-800">
              Abra <strong>Microsoft Authenticator</strong>, <strong>Google Authenticator</strong>{' '}
              ou outro app autenticador, encontre a entrada do PJE e digite o código de 6 dígitos
              que aparece na tela.
            </div>
          )}

          {erro && (
            <div className="mb-4 p-3 bg-red-50 border-2 border-red-200 flex items-start gap-2">
              <AlertCircle size={16} className="text-red-600 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-red-700">{erro}</p>
            </div>
          )}

          <form onSubmit={handleSubmit2FA}>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              Código de 6 dígitos
            </label>
            <input
              type="text"
              maxLength={6}
              pattern="\d{6}"
              inputMode="numeric"
              value={codigo2FA}
              onChange={(e) => setCodigo2FA(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
              className="w-full px-4 py-3 border-2 border-slate-200 text-center text-2xl tracking-[0.5em] font-mono focus:border-slate-900 focus:outline-none"
              disabled={carregando}
              autoFocus
              autoComplete="one-time-code"
            />
            <button
              type="submit"
              disabled={carregando || codigo2FA.length !== 6}
              className="w-full mt-4 px-4 py-3 bg-slate-900 text-white font-bold text-sm hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {carregando ? <Loader2 size={16} className="animate-spin" /> : null}
              {carregando ? 'Verificando...' : 'Verificar código'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto">
      <div className="border-2 border-slate-200 p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-slate-900 flex items-center justify-center">
            <Lock size={20} className="text-white" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900">Login PJE/TJBA</h3>
            <p className="text-sm text-slate-500">Use suas credenciais do PJE</p>
          </div>
        </div>
        {erro && (
          <div className="mb-4 p-3 bg-red-50 border-2 border-red-200 flex items-start gap-2">
            <AlertCircle size={16} className="text-red-600 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-red-700">{erro}</p>
          </div>
        )}
        <form onSubmit={handleSubmitLogin}>
          <div className="mb-4">
            <label className="block text-sm font-semibold text-slate-700 mb-1">CPF</label>
            <input
              type="text"
              value={cpf}
              onChange={(e) => setCpf(e.target.value)}
              placeholder="000.000.000-00"
              autoComplete="username"
              className="w-full px-4 py-2.5 border-2 border-slate-200 focus:border-slate-900 focus:outline-none text-sm"
              disabled={carregando}
            />
          </div>
          <div className="mb-6">
            <label className="block text-sm font-semibold text-slate-700 mb-1">Senha</label>
            <input
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              placeholder="Senha do PJE"
              autoComplete="current-password"
              className="w-full px-4 py-2.5 border-2 border-slate-200 focus:border-slate-900 focus:outline-none text-sm"
              disabled={carregando}
            />
          </div>
          <button
            type="submit"
            disabled={carregando || !cpf.trim() || !senha.trim()}
            className="w-full px-4 py-3 bg-slate-900 text-white font-bold text-sm hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {carregando ? <Loader2 size={16} className="animate-spin" /> : null}
            {carregando ? 'Autenticando...' : 'Entrar no PJE'}
          </button>
        </form>
        <p className="mt-4 text-xs text-slate-400 text-center">
          Suas credenciais são enviadas diretamente ao PJE e não são armazenadas.
        </p>
      </div>
    </div>
  );
}
