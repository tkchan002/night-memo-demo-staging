/**
 * Sanitises the small, administrator-authored CSS extension supported by the
 * manager print-template editor. This is intentionally conservative: markup
 * delimiters and active URL schemes are not valid extension inputs.
 */
export function sanitizeTemplateCss(css) {
  return String(css || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@import[^;{}]+;?/gi, '')
    .replace(/expression\s*\([^)]*\)/gi, '')
    .replace(/url\s*\(\s*(['"]?)\s*(?:javascript|data\s*:\s*text\/html)[^)]*\1\s*\)/gi, '')
    .replace(/[<>]/g, '');
}

export function isTrustedWindowMessage(event, expectedSource, expectedOrigin) {
  return event?.source === expectedSource && event?.origin === expectedOrigin;
}
