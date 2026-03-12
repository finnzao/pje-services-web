import type { FormFieldsResult } from './types';

// Mapa completo de entidades HTML com foco nas que aparecem em nomes do PJE
const HTML_ENTITY_MAP: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
  '&#39;': "'", '&apos;': "'", '&nbsp;': ' ', '&middot;': '·',
  // Minúsculas
  '&ccedil;': 'ç', '&atilde;': 'ã', '&otilde;': 'õ',
  '&aacute;': 'á', '&eacute;': 'é', '&iacute;': 'í', '&oacute;': 'ó', '&uacute;': 'ú',
  '&agrave;': 'à', '&egrave;': 'è', '&igrave;': 'ì', '&ograve;': 'ò', '&ugrave;': 'ù',
  '&acirc;': 'â',  '&ecirc;': 'ê',  '&icirc;': 'î',  '&ocirc;': 'ô',  '&ucirc;': 'û',
  '&atild;': 'ã',  '&otild;': 'õ',  '&ntilde;': 'ñ',
  '&auml;': 'ä', '&euml;': 'ë', '&iuml;': 'ï', '&ouml;': 'ö', '&uuml;': 'ü',
  '&aring;': 'å', '&aelig;': 'æ', '&szlig;': 'ß',
  '&ordf;': 'ª', '&ordm;': 'º',   // ← CRÍTICO: "11ª VARA", "1º"
  // Maiúsculas
  '&Ccedil;': 'Ç', '&Atilde;': 'Ã', '&Otilde;': 'Õ',
  '&Aacute;': 'Á', '&Eacute;': 'É', '&Iacute;': 'Í', '&Oacute;': 'Ó', '&Uacute;': 'Ú',
  '&Agrave;': 'À', '&Egrave;': 'È', '&Igrave;': 'Ì', '&Ograve;': 'Ò', '&Ugrave;': 'Ù',
  '&Acirc;': 'Â',  '&Ecirc;': 'Ê',  '&Icirc;': 'Î',  '&Ocirc;': 'Ô',  '&Ucirc;': 'Û',
  '&Auml;': 'Ä', '&Euml;': 'Ë', '&Iuml;': 'Ï', '&Ouml;': 'Ö', '&Uuml;': 'Ü',
  '&Aring;': 'Å', '&AElig;': 'Æ', '&Ntilde;': 'Ñ',
};

export function decodeHtmlEntities(text: string): string {
  return text
    // Named entities via mapa
    .replace(/&[a-zA-Z]+;/g, (entity) => HTML_ENTITY_MAP[entity] ?? entity)
    // Numeric decimal: &#186; → 'º'
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(parseInt(c, 10)))
    // Numeric hex: &#xBA; → 'º'
    .replace(/&#x([0-9a-fA-F]+);/g, (_, c) => String.fromCharCode(parseInt(c, 16)))
    .trim();
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function cleanText(html: string): string {
  return decodeHtmlEntities(stripHtml(html));
}

export function extractViewState(html: string): string | null {
  const strategies = [
    // Dentro do form papeisUsuarioForm
    () => {
      const m = html.match(/<form[^>]+(?:id|name)="papeisUsuarioForm"[^>]*>([\s\S]*?)<\/form>/i);
      return m ? extractVSFromFragment(m[1]) : null;
    },
    // Qualquer form POST
    () => {
      for (const fm of html.matchAll(/<form[^>]+method="post"[^>]*>([\s\S]*?)<\/form>/gi)) {
        const vs = extractVSFromFragment(fm[1]);
        if (vs) return vs;
      }
      return null;
    },
    () => html.match(/<input[^>]+name="javax\.faces\.ViewState"[^>]+value="([^"]+)"/i)?.[1] ?? null,
    () => html.match(/<input[^>]+value="([^"]+)"[^>]+name="javax\.faces\.ViewState"/i)?.[1] ?? null,
    () => html.match(/<input[^>]+id="javax\.faces\.ViewState"[^>]+value="([^"]+)"/i)?.[1] ?? null,
    () => html.match(/javax\.faces\.ViewState[\s\S]{0,300}?value="([^"]{10,})"/i)?.[1] ?? null,
  ];

  for (let i = 0; i < strategies.length; i++) {
    try {
      const r = strategies[i]();
      if (r?.length) {
        console.log(`[PJE-AUTH] ViewState estratégia ${i + 1} (${r.length} chars)`);
        return r;
      }
    } catch { }
  }
  return null;
}

function extractVSFromFragment(fragment: string): string | null {
  const patterns = [
    /<input[^>]+name="javax\.faces\.ViewState"[^>]+value="([^"]+)"/i,
    /<input[^>]+value="([^"]+)"[^>]+name="javax\.faces\.ViewState"/i,
    /<input[^>]+id="javax\.faces\.ViewState"[^>]+value="([^"]+)"/i,
  ];
  for (const p of patterns) {
    const m = fragment.match(p);
    if (m?.[1]) return m[1];
  }
  return null;
}

export function extractFormFields(html: string, baseUrl: string): FormFieldsResult {
  const fields: Record<string, string> = {};
  let formHtml = '';
  let actionUrl: string | null = null;

  // Prioriza form com id kc-form-login (SSO Keycloak)
  const kcMatch = html.match(/<form[^>]+id="kc-form-login"[^>]*>([\s\S]*?)<\/form>/i);
  if (kcMatch) {
    formHtml = kcMatch[0];
    const am = kcMatch[0].match(/action="([^"]+)"/i);
    if (am) {
      const a = am[1].replace(/&amp;/g, '&');
      actionUrl = a.startsWith('http') ? a : resolveUrl(a, baseUrl);
    }
  }

  if (!actionUrl) {
    const postMatch = html.match(/<form[^>]+method="post"[^>]*>([\s\S]*?)<\/form>/i)
      || html.match(/<form[^>]*>([\s\S]*?)<\/form>/i);
    if (postMatch) {
      formHtml = postMatch[0];
      const am = postMatch[0].match(/action="([^"]+)"/i);
      if (am) {
        const a = am[1].replace(/&amp;/g, '&');
        actionUrl = a.startsWith('http') ? a : resolveUrl(a, baseUrl);
      }
    }
  }

  if (!actionUrl) {
    const am = html.match(/action="([^"]+)"/i);
    if (am) {
      const a = am[1].replace(/&amp;/g, '&');
      actionUrl = a.startsWith('http') ? a : resolveUrl(a, baseUrl);
    }
    return { actionUrl, fields };
  }

  // Extrai campos hidden e text (não submit/button)
  const inputRegex = /<input[^>]*>/gi;
  let m;
  while ((m = inputRegex.exec(formHtml)) !== null) {
    const tag = m[0];
    const nameM = tag.match(/name="([^"]*)"/i);
    if (!nameM) continue;
    const typeM = tag.match(/type="([^"]*)"/i);
    const type = typeM?.[1].toLowerCase() ?? 'text';
    if (['submit', 'button', 'image'].includes(type)) continue;
    const valueM = tag.match(/value="([^"]*)"/i);
    fields[nameM[1]] = valueM ? valueM[1].replace(/&amp;/g, '&') : '';
  }

  console.log(`[PJE-AUTH] Form fields: [${Object.keys(fields).join(', ')}]`);
  return { actionUrl, fields };
}

/**
 * Detecta se a página retornada pelo SSO é um formulário de 2FA.
 *
 * FIX: Diferencia o formulário de login (username/password) do formulário de 2FA.
 * Quando o SSO re-exibe o formulário de login (por race condition ou sessão
 * transitória), isso NÃO deve ser tratado como 2FA.
 *
 * Também removidos termos genéricos demais ('digit', 'código') que causavam
 * falsos positivos em páginas em português.
 */
export function detect2FA(html: string, url: string): boolean {
  const lower = html.toLowerCase();

  // Só detecta se URL ainda está no SSO (não voltou para pje.tjba.jus.br)
  const stillInSSO = url.includes('sso.cloud.pje.jus.br');
  if (!stillInSSO) return false;

  // Se o formulário de login (username/password) está presente, NÃO é 2FA.
  // É o SSO pedindo credenciais novamente (sessão não se estabeleceu).
  const hasLoginForm = lower.includes('kc-form-login') &&
    (lower.includes('name="username"') || lower.includes('name="password"'));
  if (hasLoginForm) {
    console.log('[PJE-AUTH] detect2FA: formulário de login detectado (username/password presente) — NÃO é 2FA');
    return false;
  }

  // Padrões específicos de 2FA (removidos 'digit' e 'código' por serem genéricos demais)
  const specific2FAPatterns = [
    'codigo enviado',       // mensagem explícita de código enviado
    'verification code',    // inglês
    'otp',                  // one-time password
    'two-factor',           // inglês
    'totp',                 // time-based OTP
    'authenticator',        // app autenticador
    'token de acesso',      // PJE específico
    'informe o código',     // instrução de 2FA
    'enviamos um código',   // instrução de 2FA
    'código de verificação', // específico o suficiente
  ];

  const bodyHas2FA = specific2FAPatterns.some(p => lower.includes(p));
  const urlHas2FA = url.includes('otp') || url.includes('totp');

  // Verificação adicional: se a página tem um campo de input para código
  // mas NÃO tem campos username/password, é provavelmente 2FA
  const hasCodeInput = lower.includes('name="code"') ||
    lower.includes('name="otp"') ||
    lower.includes('name="totp"') ||
    lower.includes('id="code"') ||
    lower.includes('id="otp"');

  const is2FA = bodyHas2FA || urlHas2FA || hasCodeInput;

  if (is2FA) {
    console.log(`[PJE-AUTH] detect2FA: 2FA detectado (bodyHas2FA=${bodyHas2FA}, urlHas2FA=${urlHas2FA}, hasCodeInput=${hasCodeInput})`);
  }

  return is2FA;
}

/**
 * Verifica se a página do SSO é apenas o formulário de login re-exibido
 * (não é 2FA, não é erro — apenas o SSO pedindo credenciais novamente).
 */
export function isLoginFormReappearing(html: string, url: string): boolean {
  if (!url.includes('sso.cloud.pje.jus.br')) return false;
  const lower = html.toLowerCase();
  return (lower.includes('kc-form-login') || lower.includes('name="username"')) &&
    lower.includes('name="password"') &&
    !detect2FA(html, url);
}

export function extractLoginError(html: string): string | null {
  const patterns: Array<{ regex: RegExp; message?: string }> = [
    { regex: /class="[^"]*kc-feedback-text[^"]*"[^>]*>([^<]+)/i },
    { regex: /id="kc-error-message"[^>]*>([^<]+)/i },
    { regex: /class="[^"]*alert-error[^"]*"[^>]*>([^<]+)/i },
    { regex: /<span[^>]*class="[^"]*kc-feedback-text[^"]*"[^>]*>([\s\S]*?)<\/span>/i },
    { regex: /Invalid username or password/i, message: 'CPF ou senha incorretos.' },
    { regex: /invalid.*credentials/i, message: 'CPF ou senha incorretos.' },
    { regex: /Usu.rio ou senha inv.lidos/i, message: 'CPF ou senha incorretos.' },
    { regex: /Account is disabled/i, message: 'Conta desativada.' },
    { regex: /Account is locked/i, message: 'Conta bloqueada.' },
    { regex: /Conta bloqueada/i, message: 'Conta bloqueada.' },
  ];
  for (const { regex, message } of patterns) {
    const match = html.match(regex);
    if (match) {
      if (message) return message;
      const text = decodeHtmlEntities(stripHtml((match[1] || '').trim()));
      if (text.length > 2 && text.length < 200) return text;
    }
  }
  return null;
}

// Verifica se URL é do painel PJE (autenticado)
export function isLoggedInUrl(url: string): boolean {
  if (!url.includes('pje.tjba.jus.br')) return false;
  return url.includes('painel') ||
    url.includes('dev.seam') ||
    url.includes('ng2') ||
    url.includes('token.seam') || // token.seam = primeiro destino após SSO
    url.endsWith('/pje/') ||
    url.match(/\/pje\/(Processo|magistrado|servidor|advogado)/) !== null;
}

// Verifica se está na página de seleção de perfis
export function isProfileSelectionPage(html: string): boolean {
  return html.includes('papeisUsuarioForm') || html.includes('dtPerfil');
}

export function resolveUrl(location: string, base: string): string {
  if (location.startsWith('http')) return location;
  try { return new URL(location, base).toString(); } catch { return location; }
}