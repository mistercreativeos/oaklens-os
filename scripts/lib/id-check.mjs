// Tiny CLI wrapper around looksLikeResourceId, so setup.sh can validate a
// hand-pasted ID without hand-rolling the pattern in bash (twice, differently).
// Exit 0 = looks like an ID, exit 1 = does not.
import { looksLikeResourceId } from './wrangler-parse.mjs';
process.exit(looksLikeResourceId(process.argv[2]) ? 0 : 1);
