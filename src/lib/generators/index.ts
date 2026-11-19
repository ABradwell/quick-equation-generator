import { generate as go } from './go.ts';
import { generate as python } from './python.ts';
import { generate as rust } from './rust.ts';
import { generate as typescript } from './typescript.ts';
import { generate as java } from './java.ts';
import type { Generator } from './shared.ts';

export interface Language {
  label: string;
  generate: Generator;
}

export type LanguageId = 'python' | 'typescript' | 'go' | 'rust' | 'java';

/** Each generator takes a parseEquation() result and returns standalone source code. */
export const LANGUAGES: Record<LanguageId, Language> = {
  python: { label: 'Python', generate: python },
  typescript: { label: 'TypeScript', generate: typescript },
  go: { label: 'Go', generate: go },
  rust: { label: 'Rust', generate: rust },
  java: { label: 'Java', generate: java },
};
