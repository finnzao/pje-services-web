'use client';

import React, { useState } from 'react';
import { Lock, Mail, Smartphone, Loader2, AlertCircle, ShieldCheck } from 'lucide-react';

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
  const cpfDigitos = cpf.replace(/\D/g, '');

  const handleSubmitLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (cpfDigitos.length !== 11 || !senha.trim()) return;
    onLogin(cpfDigitos, senha);
  };

  const handleSubmit2FA = (e: React.FormEvent) => {
    e.preventDefault();
    if (codigo2FA.length !== 6) return;
    onEnviar2FA(codigo2FA);
  };

  // ===== Etapa 2FA =====
  if (aguardando2FA) {
    const isTotp = twoFactorType === 'totp';
    return (
      <div className="mx-auto max-w-md animate-rise">
        <div className="surface overflow-hidden">
          <div className="flex items-center gap-4 border-b border-slate-100 px-7 py-6">
            <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${isTotp ? 'bg-navy-50 text-navy-700' : 'bg-brass-50 text-brass-600'}`}>
              {isTotp ? <Smartphone size={20} /> : <Mail size={20} />}
            </div>
            <div>
              <h3 className="font-display text-xl font-semibold text-ink">Verificação em duas etapas</h3>
              <p className="text-sm text-slate-500">{isTotp ? 'Abra seu app autenticador' : 'Código enviado para seu e-mail'}</p>
            </div>
          </div>

          <div className="px-7 py-6">
            {isTotp && (
              <p className="mb-4 rounded-xl bg-navy-50 px-3.5 py-3 text-xs leading-relaxed text-navy-700">
                Abra o <strong>Microsoft Authenticator</strong>, <strong>Google Authenticator</strong> ou app equivalente,
                localize a entrada do PJE e informe o código de 6 dígitos.
              </p>
            )}

            {erro && <Alerta>{erro}</Alerta>}

            <form onSubmit={handleSubmit2FA}>
              <label className="label mb-2">Código de verificação</label>
              <input
                type="text" maxLength={6} inputMode="numeric" autoFocus autoComplete="one-time-code"
                value={codigo2FA}
                onChange={(e) => setCodigo2FA(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                disabled={carregando}
                className="field text-center font-mono text-3xl tracking-[0.5em]"
              />
              <button type="submit" disabled={carregando || codigo2FA.length !== 6} className="btn btn-primary mt-5 w-full py-3 text-sm">
                {carregando ? <><Loader2 size={16} className="animate-spin" /> Verificando…</> : <><ShieldCheck size={16} /> Verificar código</>}
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // ===== Etapa de login =====
  return (
    <div className="mx-auto max-w-md animate-rise">
      <div className="surface overflow-hidden">
        <div className="flex items-center gap-4 border-b border-slate-100 px-7 py-6">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-navy-800 text-white">
            <Lock size={20} />
          </div>
          <div>
            <h3 className="font-display text-xl font-semibold text-ink">Acesso ao PJE/TJBA</h3>
            <p className="text-sm text-slate-500">Use suas credenciais do PJE</p>
          </div>
        </div>

        <div className="px-7 py-6">
          {erro && <Alerta>{erro}</Alerta>}

          <form onSubmit={handleSubmitLogin} className="space-y-4">
            <div>
              <label className="label mb-1.5">CPF</label>
              <input
                type="text" value={cpf} onChange={(e) => setCpf(formatarCpf(e.target.value))}
                placeholder="000.000.000-00" autoComplete="username" inputMode="numeric" maxLength={14}
                disabled={carregando} aria-invalid={cpf.length > 0 && cpfDigitos.length !== 11}
                aria-describedby="cpf-ajuda"
                className="field font-mono"
              />
              <p id="cpf-ajuda" className={`mt-1 text-xs ${cpf.length > 0 && cpfDigitos.length !== 11 ? 'text-red-600' : 'text-slate-500'}`}>
                {cpf.length > 0 && cpfDigitos.length !== 11 ? `${cpfDigitos.length}/11 dígitos` : 'Somente números; a formatação é automática.'}
              </p>
            </div>
            <div>
              <label className="label mb-1.5">Senha</label>
              <input
                type="password" value={senha} onChange={(e) => setSenha(e.target.value)}
                placeholder="Senha do PJE" autoComplete="current-password" disabled={carregando}
                className="field"
              />
            </div>
            <button type="submit" disabled={carregando || cpfDigitos.length !== 11 || !senha.trim()} className="btn btn-primary w-full py-3 text-sm">
              {carregando ? <><Loader2 size={16} className="animate-spin" /> Autenticando…</> : 'Entrar no PJE'}
            </button>
          </form>

          <p className="mt-5 flex items-center justify-center gap-1.5 text-center text-xs text-slate-500">
            <ShieldCheck size={13} /> Credenciais enviadas diretamente ao PJE — não são armazenadas.
          </p>
        </div>
      </div>
    </div>
  );
}

/** Máscara 000.000.000-00 aplicada conforme o usuário digita (só dígitos são mantidos). */
function formatarCpf(valor: string): string {
  const d = valor.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

function Alerta({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
      <AlertCircle size={16} className="mt-0.5 flex-shrink-0 text-red-500" />
      <span>{children}</span>
    </div>
  );
}
