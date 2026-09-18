import type { Direction } from '../../shared/types';
import { BEAUTIFY_PROMPT } from './beautifyAdapter';
import { FORMALISE_PROMPT } from './formalise';
import type { DirectionPrompt } from './types';

export type { DirectionPrompt, ParsedRewrite } from './types';
export {
  REWRITE_SCHEMA,
  SUBSTANCE_KINDS,
  parseRewriteResponse,
  type RewriteResponse,
} from './schema';
export { parseBeautifyResponse } from './beautifyAdapter';

const PROMPTS: Readonly<Record<Direction, DirectionPrompt>> = {
  formalise: FORMALISE_PROMPT,
  beautify: BEAUTIFY_PROMPT,
};

/** The prompt for a direction. One file per direction under `src/main/prompts/`. */
export function promptFor(direction: Direction): DirectionPrompt {
  return PROMPTS[direction];
}
