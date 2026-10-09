// scripts/deploy.mjs: the deploy Cloudflare's builds run (package.json "deploy").
// On those builds (WORKERS_CI=1) it tells the site it deploys from git and
// which repo it came from; anywhere else it is plain `wrangler deploy`.
import { describe, it, expect } from 'vitest';
import { deployArgs, repoFromRemote } from '../scripts/deploy.mjs';

describe('the deploy step', () => {
  it('is plain wrangler deploy outside Cloudflare builds', () => {
    expect(deployArgs({}, 'https://github.com/ada/my-studio.git')).toEqual(['wrangler', 'deploy']);
    expect(deployArgs({ WORKERS_CI: '0' }, 'https://github.com/ada/my-studio')).toEqual(['wrangler', 'deploy']);
  });

  it('on a Cloudflare build, says the repo is connected and which repo it is', () => {
    expect(deployArgs({ WORKERS_CI: '1' }, 'https://github.com/ada/my-studio.git')).toEqual([
      'wrangler', 'deploy', '--var', 'REPO_CONNECTED:true', '--var', 'GIT_REPO:ada/my-studio',
    ]);
  });

  it('still says connected when the remote cannot be read', () => {
    expect(deployArgs({ WORKERS_CI: '1' }, '')).toEqual(['wrangler', 'deploy', '--var', 'REPO_CONNECTED:true']);
  });
});

describe('the repo, from the checkout\'s remote', () => {
  it('reads https and ssh remotes', () => {
    expect(repoFromRemote('https://github.com/ada/my-studio.git')).toBe('ada/my-studio');
    expect(repoFromRemote('https://github.com/ada/my-studio')).toBe('ada/my-studio');
    expect(repoFromRemote('git@github.com:ada/my.studio.git')).toBe('ada/my.studio');
  });

  it('never carries credentials from the URL', () => {
    const r = repoFromRemote('https://x-access-token:ghs_SECRET123@github.com/ada/my-studio.git');
    expect(r).toBe('ada/my-studio');
    expect(deployArgs({ WORKERS_CI: '1' }, 'https://x-access-token:ghs_SECRET123@github.com/ada/my-studio.git').join(' '))
      .not.toMatch(/SECRET/);
  });

  it('gives nothing for a remote that is not GitHub', () => {
    expect(repoFromRemote('https://gitlab.com/ada/my-studio.git')).toBe(null);
    expect(repoFromRemote('')).toBe(null);
  });
});
