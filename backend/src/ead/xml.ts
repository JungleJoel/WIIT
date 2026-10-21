/**
 * Tiny XML writer – enough for EAD3, no dependencies.
 *
 *   el('unittitle', {}, 'Fakturor')                 → <unittitle>Fakturor</unittitle>
 *   el('c', { level: 'series' }, [el(...), el(...)]) → nested, indented
 *   el('dao', { href: '…' })                         → <dao href="…"/>
 *
 * null / undefined / false children and attributes are skipped, so callers can write
 * `cond && el(...)` without if-statements.
 */

/** Attribute values: null / undefined / false / '' are left out of the output. */
export type AttrValue = string | number | boolean | null | undefined;
export type Attrs = Record<string, AttrValue>;

/**
 * A child in a content list. The falsy variants are what `cond && el(...)` produces
 * when cond is a string, number or optional value – they are skipped when rendering.
 */
export type XmlChild = XmlElement | null | undefined | false | '' | 0;

/** Text content, a list of children, or nothing (self-closing tag). */
export type XmlContent = string | number | XmlChild[] | null | undefined;

export interface XmlElement {
  name: string;
  attrs: Attrs;
  content: XmlContent;
}

export function escapeText(s: unknown): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // XML 1.0 forbids most control characters – drop them instead of producing invalid XML
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

export function escapeAttr(s: unknown): string {
  return escapeText(s).replace(/"/g, '&quot;');
}

export function el(name: string, attrs: Attrs = {}, content: XmlContent = null): XmlElement {
  return { name, attrs, content };
}

const isElement = (c: XmlChild): c is XmlElement => Boolean(c);

export function render(node: XmlElement, depth = 0): string {
  const pad = '  '.repeat(depth);
  const attrs = Object.entries(node.attrs || {})
    .filter(([, v]) => v !== null && v !== undefined && v !== false && v !== '')
    .map(([k, v]) => ` ${k}="${escapeAttr(v)}"`)
    .join('');

  const content = node.content;
  if (content === null || content === undefined || (Array.isArray(content) && content.filter(isElement).length === 0)) {
    return `${pad}<${node.name}${attrs}/>`;
  }
  if (!Array.isArray(content)) {
    return `${pad}<${node.name}${attrs}>${escapeText(content)}</${node.name}>`;
  }
  const inner = content.filter(isElement).map((c) => render(c, depth + 1)).join('\n');
  return `${pad}<${node.name}${attrs}>\n${inner}\n${pad}</${node.name}>`;
}

/** Valid xml:id / @id values must be NCNames (start with a letter or _, no spaces or colons). */
export function isNcName(s: unknown): s is string {
  return typeof s === 'string' && /^[A-Za-z_][A-Za-z0-9._-]*$/.test(s);
}
