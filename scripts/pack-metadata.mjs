import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync, unlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const packagePath = 'package.json';
const backupPath = join(tmpdir(), `timeline-composition-package-${createHash('sha256').update(process.cwd()).digest('hex')}.json`);
const git = (...args) => execFileSync('git', args, {encoding: 'utf8'}).trim();

if (process.argv[2] === 'prepare') {
  const changes = git('status', '--porcelain', '--untracked-files=all');
  if (changes) throw new Error(`Refusing to pack a dirty source tree:\n${changes}`);

  const commit = git('rev-parse', '--verify', 'HEAD');
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('Expected a full source commit SHA');
  if (process.env.GITHUB_SHA && process.env.GITHUB_SHA !== commit) {
    throw new Error(`Checked out source ${commit} does not match GITHUB_SHA ${process.env.GITHUB_SHA}`);
  }

  execFileSync('npm', ['run', 'build'], {stdio: 'inherit'});
  const original = readFileSync(packagePath, 'utf8');
  writeFileSync(backupPath, original);
  const metadata = JSON.parse(original);
  metadata.gitHead = commit;
  metadata.repository ??= {
    type: 'git',
    url: 'https://github.com/banodoco/timeline-composition.git',
  };
  writeFileSync(packagePath, `${JSON.stringify(metadata, null, 2)}\n`);
} else if (process.argv[2] === 'restore') {
  try {
    writeFileSync(packagePath, readFileSync(backupPath));
    unlinkSync(backupPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
} else {
  throw new Error('Expected prepare or restore');
}
