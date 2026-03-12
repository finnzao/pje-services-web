export interface PJELoginResult {
  needs2FA: boolean;
  sessionId?: string;
  user?: PJEUserInfo;
  profiles?: PJEProfile[];
  error?: string;
}

export interface PJEUserInfo {
  idUsuario: number;
  nomeUsuario: string;
  login: string;
  perfil: string;
  nomePerfil: string;
  idUsuarioLocalizacaoMagistradoServidor: number;
}

export interface PJEProfile {
  indice: number;
  nome: string;
  orgao: string;
  favorito: boolean;
}

export interface PJEProfileResult {
  tasks: PJETask[];
  favoriteTasks: PJETask[];
  tags: PJETag[];
  error?: string;
}

export interface PJETask {
  id: number;
  nome: string;
  quantidadePendente: number;
}

export interface PJETag {
  id: number;
  nomeTag: string;
  nomeTagCompleto: string;
  favorita: boolean;
}

export interface StoredSession {
  cookies: Record<string, string>;
  idUsuarioLocalizacao: string;
  idUsuario?: number;
  ssoHtml?: string;
  ssoFinalUrl?: string;
  cpf?: string;
  createdAt?: number;
}

export interface PersistedSession {
  cookies: Record<string, string>;
  idUsuarioLocalizacao: string;
  idUsuario?: number;
  user?: PJEUserInfo;
  updatedAt: number;
}

export interface FollowRedirectsResult {
  body: string;
  finalUrl: string;
  status: number;
}

export interface FormFieldsResult {
  actionUrl: string | null;
  fields: Record<string, string>;
}

export interface ProfileMapping {
  virtualIndex: number;
  tbodyIndex: number;
  nome: string;
  isActive: boolean;
}
