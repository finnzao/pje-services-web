const IS_DEV =
  typeof window !== 'undefined' &&
  (process.env.NEXT_PUBLIC_PJE_DEBUG === 'true' ||
   process.env.NODE_ENV === 'development');

type LogLevel = 'info' | 'warn' | 'error' | 'success' | 'debug';

const CORES: Record<LogLevel, string> = {
  info:    'color:#3b82f6;font-weight:bold',
  warn:    'color:#f59e0b;font-weight:bold',
  error:   'color:#ef4444;font-weight:bold',
  success: 'color:#10b981;font-weight:bold',
  debug:   'color:#8b5cf6;font-weight:bold',
};

function timestamp(): string {
  return new Date().toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  });
}

function serializeDados(dados: unknown): unknown {
  if (dados === undefined || dados === null) return dados;
  if (dados instanceof Error) {
    return {
      tipo: dados.name,
      mensagem: dados.message,
      stack: dados.stack?.split('\n').slice(0, 5).join('\n'),
    };
  }
  if (typeof dados === 'object' && dados !== null && Object.keys(dados).length === 0) {
    return '(objeto vazio)';
  }
  return dados;
}

function log(level: LogLevel, modulo: string, mensagem: string, dados?: unknown): void {
  if (!IS_DEV) return;
  const ts = timestamp();
  const prefix = `%c[PJE ${ts}] [${modulo}]`;
  const serializedDados = serializeDados(dados);

  if (level === 'error') {
    console.group(`${prefix} ${mensagem}`, CORES[level]);
    if (serializedDados !== undefined) console.log(serializedDados);
    console.trace('Stack trace');
    console.groupEnd();
  } else if (serializedDados !== undefined) {
    console.groupCollapsed(`${prefix} ${mensagem}`, CORES[level]);
    console.log(serializedDados);
    console.groupEnd();
  } else {
    console.log(`${prefix} ${mensagem}`, CORES[level]);
  }
}

export const logger = {
  info: (modulo: string, mensagem: string, dados?: unknown) => log('info', modulo, mensagem, dados),
  warn: (modulo: string, mensagem: string, dados?: unknown) => log('warn', modulo, mensagem, dados),
  error: (modulo: string, mensagem: string, dados?: unknown) => log('error', modulo, mensagem, dados),
  success: (modulo: string, mensagem: string, dados?: unknown) => log('success', modulo, mensagem, dados),
  debug: (modulo: string, mensagem: string, dados?: unknown) => log('debug', modulo, mensagem, dados),
  async time<T>(modulo: string, label: string, fn: () => Promise<T>): Promise<T> {
    if (!IS_DEV) return fn();
    const inicio = performance.now();
    log('info', modulo, `Iniciando: ${label}`);
    try {
      const resultado = await fn();
      const duracao = (performance.now() - inicio).toFixed(0);
      log('success', modulo, `Concluido: ${label} (${duracao}ms)`, resultado);
      return resultado;
    } catch (err) {
      const duracao = (performance.now() - inicio).toFixed(0);
      const errMsg = err instanceof Error ? err.message : String(err);
      log('error', modulo, `Falhou: ${label} - ${errMsg} (${duracao}ms)`, err);
      throw err;
    }
  },
};
