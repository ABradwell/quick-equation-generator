import { generate as go } from './go.js';
import { generate as python } from './python.js';
import { generate as rust } from './rust.js';
import { generate as typescript } from './typescript.js';
import { generate as java } from './java.js';

/** Each generator takes a parseEquation() result and returns standalone source code. */
export const LANGUAGES = {
  python: { label: 'Python', generate: python },
  typescript: { label: 'TypeScript', generate: typescript },
  go: { label: 'Go', generate: go },
  rust: { label: 'Rust', generate: rust },
  java: { label: 'Java', generate: java },
};
