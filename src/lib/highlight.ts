// Small hand-written syntax highlighter for the five generated languages.
import { escapeHtml } from './render.ts';

const words = (s: string): Set<string> => new Set(s.split(/\s+/).filter(Boolean));

const SLASH_COMMENT = String.raw`//[^\n]*|/\*[\s\S]*?\*/`;
const DQ_STRING = String.raw`"(?:\\.|[^"\\\n])*"`;

interface Syntax {
  comment: string;
  string: string;
  keywords: Set<string>;
  types: Set<string>;
  re?: RegExp;
}

const SYNTAX: Record<string, Syntax> = {
  python: {
    comment: String.raw`#[^\n]*`,
    string: String.raw`"""[\s\S]*?"""|'''[\s\S]*?'''|${DQ_STRING}|'(?:\\.|[^'\\\n])*'`,
    keywords: words(
      'def return import from as if elif else for in while lambda and or not is pass class try except raise with yield global None True False',
    ),
    types: words('float int str bool'),
  },
  typescript: {
    comment: SLASH_COMMENT,
    string: String.raw`${DQ_STRING}|'(?:\\.|[^'\\\n])*'|\x60(?:\\.|[^\x60\\])*\x60`,
    keywords: words(
      'function return const let var export default import from as if else for while of in new class type interface throw typeof true false null undefined',
    ),
    types: words('number boolean string void any unknown'),
  },
  go: {
    comment: SLASH_COMMENT,
    string: String.raw`${DQ_STRING}|\x60[^\x60]*\x60`,
    keywords: words(
      'package import func return var const if else for range switch case default type struct true false nil',
    ),
    types: words('float64 float32 int int32 int64 string bool'),
  },
  rust: {
    comment: SLASH_COMMENT,
    string: DQ_STRING,
    keywords: words(
      'fn pub let mut return if else for in while loop use const static as impl struct match mod true false',
    ),
    types: words('f64 f32 i32 i64 u32 u64 usize isize bool'),
  },
  java: {
    comment: SLASH_COMMENT,
    string: DQ_STRING,
    keywords: words(
      'public private protected static final class return if else for while import new package true false null',
    ),
    types: words('double float int long boolean void String Math'),
  },
};

for (const syntax of Object.values(SYNTAX)) {
  syntax.re = new RegExp(
    `(${syntax.comment})|(${syntax.string})|(\\d[\\d_]*(?:\\.\\d*)?(?:[eE][+-]?\\d+)?(?:f64|f32|f|d|L)?|\\.\\d+(?:[eE][+-]?\\d+)?)|([A-Za-z_][A-Za-z0-9_]*)`,
    'g',
  );
}

const wrap = (cls: string, text: string): string =>
  `<span class="tk-${cls}">${escapeHtml(text)}</span>`;

/** Returns HTML for `code` with comment / string / number / keyword / type / call spans. */
export function highlight(code: string, lang: string): string {
  const syntax = SYNTAX[lang];
  if (!syntax?.re) return escapeHtml(code);
  let out = '';
  let last = 0;
  for (const m of code.matchAll(syntax.re)) {
    out += escapeHtml(code.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[1] !== undefined) out += wrap('c', m[0]);
    else if (m[2] !== undefined) out += wrap('s', m[0]);
    else if (m[3] !== undefined) out += wrap('n', m[0]);
    else if (syntax.keywords.has(m[0])) out += wrap('k', m[0]);
    else if (syntax.types.has(m[0])) out += wrap('t', m[0]);
    else if (code[last] === '(') out += wrap('f', m[0]);
    else out += escapeHtml(m[0]);
  }
  return out + escapeHtml(code.slice(last));
}
