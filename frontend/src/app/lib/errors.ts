export function extrairMensagemErro(err: unknown): string {
  if (err instanceof Error) {
    if ('status' in err && (err as any).status === 0)
      return 'Servidor indisponível. Verifique se a API está em execução.';
    return err.message;
  }
  return 'Erro desconhecido.';
}

export function extrairDadosErro(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return {
      tipo: err.name,
      mensagem: err.message,
      ...(('status' in err) ? { status: (err as any).status } : {}),
      ...(('data' in err) ? { dados: (err as any).data } : {}),
    };
  }
  return { tipo: 'Unknown', valor: String(err) };
}
