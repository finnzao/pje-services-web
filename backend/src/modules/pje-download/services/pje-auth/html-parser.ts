import type { FormFieldsResult } from './types';

const HTML_ENTITY_MAP: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
  '&#39;': "'", '&apos;': "'", '&nbsp;': ' ', '&middot;': '·',

  '&ccedil;': 'ç', '&atilde;': 'ã', '&otilde;': 'õ',
  '&aacute;': 'á', '&eacute;': 'é', '&iacute;': 'í', '&oacute;': 'ó', '&uacute;': 'ú',
  '&agrave;': 'à', '&egrave;': 'è', '&igrave;': 'ì', '&ograve;': 'ò', '&ugrave;': 'ù',
  '&acirc;': 'â',  '&ecirc;': 'ê',  '&icirc;': 'î',  '&ocirc;': 'ô',  '&ucirc;': 'û',
  '&atild;': 'ã',  '&otild;': 'õ',  '&ntilde;': 'ñ',
  '&auml;': 'ä', '&euml;': 'ë', '&iuml;': 'ï', '&ouml;': 'ö', '&uuml;': 'ü',
  '&aring;': 'å', '&aelig;': 'æ', '&szlig;': 'ß',
  '&ordf;': 'ª', '&ordm;': 'º',

  '&Ccedil;': 'Ç', '&Atilde;': 'Ã', '&Otilde;': 'Õ',
  '&Aacute;': 'Á', '&Eacute;': 'É', '&Iacute;': 'Í', '&Oacute;': 'Ó', '&Uacute;': 'Ú',
  '&Agrave;': 'À', '&Egrave;': 'È', '&Igrave;': 'Ì', '&Ograve;': 'Ò', '&Ugrave;': 'Ù',
  '&Acirc;': 'Â',  '&Ecirc;': 'Ê',  '&Icirc;': 'Î',  '&Ocirc;': 'Ô',  '&Ucirc;': 'Û',
  '&Auml;': 'Ä', '&Euml;': 'Ë', '&Iuml;': 'Ï', '&Ouml;': 'Ö', '&Uuml;': 'Ü',
  '&Aring;': 'Å', '&AElig;': 'Æ', '&Ntilde;': 'Ñ',
};

export function decodeHtmlEntities(text: string): string {
  return text

    .replace(/&[a-zA-Z]+;/g, (entity) => HTML_ENTITY_MAP[entity] ?? entity)

    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(parseInt(c, 10)))

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

    () => {
      const m = html.match(/<form[^>]+(?:id|name)="papeisUsuarioForm"[^>]*>([\s\S]*?)<\/form>/i);
      return m ? extractVSFromFragment(m[1]) : null;
    },

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

export function detect2FA(html: string, url: string): boolean {
  const lower = html.toLowerCase();

  const stillInSSO = url.includes('sso.cloud.pje.jus.br');
  if (!stillInSSO) return false;

  const hasLoginForm = lower.includes('kc-form-login') &&
    (lower.includes('name="username"') || lower.includes('name="password"'));
  if (hasLoginForm) {
    console.log('[PJE-AUTH] detect2FA: formulário de login detectado — NÃO é 2FA');
    return false;
  }

  const hasCodeInput = /<input[^>]+name="(otp|code|totp)"/i.test(html) ||
    /<input[^>]+id="(otp|code|totp)"/i.test(html);

  const specific2FAPatterns = [
    'código enviado',
    'verification code',
    'otp',
    'two-factor',
    'totp',
    'microsoft authenticator',
    'google authenticator',
    'aplicativo autenticador',
    'authenticator app',
    'token de acesso',
    'informe o código',
    'enviamos um código',
    'código de verificação',
    'one-time',
  ];
  const bodyHas2FA = specific2FAPatterns.some(p => lower.includes(p));

  const urlHas2FA = /login-actions\/authenticate/.test(url) &&
    (lower.includes('name="otp"') || lower.includes('name="code"') || lower.includes('name="totp"'));

  const is2FA = bodyHas2FA || urlHas2FA || hasCodeInput;

  if (is2FA) {
    console.log(`[PJE-AUTH] detect2FA: 2FA detectado (bodyHas2FA=${bodyHas2FA}, urlHas2FA=${urlHas2FA}, hasCodeInput=${hasCodeInput})`);
  }

  return is2FA;
}

export interface TwoFactorFormInfo {

  actionUrl: string;

  fieldName: 'otp' | 'code';

  isTotp: boolean;

  extraFormFields: Record<string, string>;

  keycloakParams: {
    session_code?: string;
    execution?: string;
    client_id?: string;
    tab_id?: string;
  };
}

export function extract2FAFormInfo(html: string, currentUrl: string): TwoFactorFormInfo | null {

  const formData = extractFormFields(html, currentUrl);
  if (!formData.actionUrl) {
    console.warn('[PJE-AUTH] extract2FAFormInfo: form sem actionUrl');
    return null;
  }

  const lower = html.toLowerCase();
  const hasOtpInput = /<input[^>]+name="otp"/i.test(html);
  const hasCodeInput = /<input[^>]+name="code"/i.test(html);

  const totpIndicators = [
    /microsoft\s*authenticator/i,
    /google\s*authenticator/i,
    /aplicativo\s*autenticador/i,
    /app\s*autenticador/i,
    /authenticator\s*app/i,
    /\btotp\b/i,
    /one[\s-]?time[\s-]?password/i,
  ];
  const hasTotpText = totpIndicators.some((re) => re.test(lower));

  let isTotp: boolean;
  let fieldName: 'otp' | 'code';
  if (hasOtpInput) {
    isTotp = true;
    fieldName = 'otp';
  } else if (hasCodeInput) {
    isTotp = hasTotpText;
    fieldName = 'code';
  } else {

    isTotp = hasTotpText;
    fieldName = isTotp ? 'otp' : 'code';
  }

  const extraFormFields: Record<string, string> = {};
  for (const [k, v] of Object.entries(formData.fields)) {
    if (k !== fieldName && k !== 'otp' && k !== 'code' && k !== 'totp') {
      extraFormFields[k] = v;
    }
  }

  const keycloakParams: TwoFactorFormInfo['keycloakParams'] = {};
  const sources = [formData.actionUrl, currentUrl];
  for (const src of sources) {
    try {
      const u = new URL(src);
      for (const p of ['session_code', 'execution', 'client_id', 'tab_id'] as const) {
        if (!keycloakParams[p]) {
          const v = u.searchParams.get(p);
          if (v) keycloakParams[p] = v;
        }
      }
    } catch {  }
  }

  console.log(
    `[PJE-AUTH] extract2FAFormInfo: field=${fieldName} isTotp=${isTotp} ` +
    `actionUrl=${formData.actionUrl.substring(0, 80)}... ` +
    `extraFields=[${Object.keys(extraFormFields).join(',')}] ` +
    `kcParams=[${Object.keys(keycloakParams).join(',')}]`,
  );

  return {
    actionUrl: formData.actionUrl,
    fieldName,
    isTotp,
    extraFormFields,
    keycloakParams,
  };
}

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

export function extract2FAError(html: string): string | null {
  const lower = html.toLowerCase();
  const patterns: Array<{ regex: RegExp; message: string }> = [
    { regex: /invalid.*code/i, message: 'Código inválido. Tente novamente.' },
    { regex: /código\s*inválido/i, message: 'Código inválido. Tente novamente.' },
    { regex: /\bexpired\b/i, message: 'Código expirado. Tente novamente.' },
    { regex: /\bexpirado\b/i, message: 'Código expirado. Tente novamente.' },
    { regex: /\bincorrect\b/i, message: 'Código incorreto. Tente novamente.' },
    { regex: /\bincorreto\b/i, message: 'Código incorreto. Tente novamente.' },
    { regex: /tente\s*novamente/i, message: 'Código inválido. Tente novamente.' },
  ];
  for (const { regex, message } of patterns) {
    if (regex.test(lower)) return message;
  }

  const fb = html.match(/class="[^"]*kc-feedback-text[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div)>/i);
  if (fb) {
    const text = decodeHtmlEntities(stripHtml(fb[1] || '')).trim();
    if (text.length > 2 && text.length < 200) return text;
  }
  return null;
}

export function isLoggedInUrl(url: string): boolean {
  if (!url.includes('pje.tjba.jus.br')) return false;
  return url.includes('painel') ||
    url.includes('dev.seam') ||
    url.includes('ng2') ||
    url.includes('token.seam') ||
    url.endsWith('/pje/') ||
    url.match(/\/pje\/(Processo|magistrado|servidor|advogado)/) !== null;
}

export function isProfileSelectionPage(html: string): boolean {
  return html.includes('papeisUsuarioForm') || html.includes('dtPerfil');
}

export function resolveUrl(location: string, base: string): string {
  if (location.startsWith('http')) return location;
  try { return new URL(location, base).toString(); } catch { return location; }
}
