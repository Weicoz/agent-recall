#!/usr/bin/env node
import { runDigest } from '../lib/digest.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const force = flag('--force');
const dry = flag('--dry');
const renderOnly = flag('--render');
const quiet = flag('--quiet');
const includeActive = flag('--include-active');
const limit = Number(opt('--limit', '0')) || 0;
const only = opt('--only', '');
const projectFilter = opt('--project', '');
const sourceFilter = opt('--source', '');
const minMsgs = Number(opt('--min', '1'));

const res = await runDigest({
  force,
  dry,
  renderOnly,
  quiet,
  includeActive,
  limit,
  only,
  projectFilter,
  sourceFilter,
  minMsgs,
});

if (!res.ok && res.reason === 'locked') {
  process.exit(1);
}
process.exit(0);
