import {writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

const git = (...args) => execFileSync('git', args, {encoding: 'utf8'}).trim();
const commit = git('rev-parse', '--verify', 'HEAD');
if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('Expected a full source commit SHA');
if (process.env.GITHUB_SHA && process.env.GITHUB_SHA !== commit) {
  throw new Error(`Checked out source ${commit} does not match GITHUB_SHA ${process.env.GITHUB_SHA}`);
}
const changes = git('status', '--porcelain', '--untracked-files=all', '--', '.', ':!source.json');
const metadata = {
  repository: 'https://github.com/banodoco/timeline-composition',
  commit,
  dirty: changes.length > 0,
};
writeFileSync('source.json', `${JSON.stringify(metadata, null, 2)}\n`);
