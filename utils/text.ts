const REGEX_SPECIAL_CHARS = /[.*+?^${}()|[\]\\]/g

const ACCENT_GROUPS: Record<string, string> = {
  a: 'aáàâäãå',
  e: 'eéèêë',
  i: 'iíìîï',
  o: 'oóòôöõ',
  u: 'uúùûü',
  y: 'yýÿ',
  n: 'nñ',
  c: 'cç'
}

const escapeRegex = (value: string): string => value.replace(REGEX_SPECIAL_CHARS, '\\$&')

/**
 * Genera un patrón de RegExp insensible a acentos a partir de un texto libre.
 * Mantiene el orden de los caracteres, pero reemplaza letras comunes por clases
 * que incluyen sus variantes acentuadas y colapsa espacios/hífens consecutivos.
 */
export const buildAccentInsensitiveRegex = (input: string): string => {
  if (!input) return ''

  const normalized = input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()

  if (!normalized) return ''

  let result = ''
  let pendingWhitespace = false

  for (const char of normalized) {
    // Tratar espacios, guiones y subrayados como separadores equivalentes
    if (/\s/.test(char) || char === '-' || char === '_') {
      pendingWhitespace = true
      continue
    }

    if (pendingWhitespace) {
      result += '[-_\\s]+'
      pendingWhitespace = false
    }

    const group = ACCENT_GROUPS[char.toLowerCase()]
    if (group) {
      result += `[${group}]`
    } else {
      result += escapeRegex(char)
    }
  }

  if (pendingWhitespace) {
    result += '[-_\\s]+'
  }

  return result
}


