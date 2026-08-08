import { describe, it, expect } from 'vitest';
import { entityJsonLd } from '../src/shared/site.js';
import siteConfig from '../site.config.js';

// entityJsonLd anchors to the configured canonical origin, so an alias
// request origin must not leak into the shipped graph.
const ALIAS_ORIGIN = 'https://instance.example.workers.dev';

function parseGraph(html) {
  const m = html.match(/^<script type="application\/ld\+json">(.*)<\/script>$/s);
  expect(m).not.toBeNull();
  return JSON.parse(m[1]);
}

describe('entityJsonLd', () => {
  it('emits a script tag wrapping valid JSON-LD', () => {
    const data = parseGraph(entityJsonLd(ALIAS_ORIGIN));
    expect(data['@context']).toBe('https://schema.org');
    expect(Array.isArray(data['@graph'])).toBe(true);
  });

  it('ships Organization + WebSite anchored to the canonical origin', () => {
    const data = parseGraph(entityJsonLd(ALIAS_ORIGIN));
    const org = data['@graph'].find((n) => n['@type'] === 'Organization');
    const site = data['@graph'].find((n) => n['@type'] === 'WebSite');

    // Mirrors the engine: a configured `url` wins, otherwise the request
    // origin. A fresh fork has no domain yet, so the fallback is the normal
    // case there — not an error.
    const canonical = (siteConfig.url || ALIAS_ORIGIN).replace(/\/+$/, '');

    expect(org.name).toBe(siteConfig.entity.name);
    expect(org.url).toBe(`${canonical}/`);
    expect(org.logo).toBe(`${canonical}${siteConfig.entity.logo}`);

    expect(site.url).toBe(`${canonical}/`);
    expect(site.publisher['@id']).toBe(org['@id']);

    // With a canonical configured, the alias origin must not leak in anywhere.
    if (siteConfig.url) expect(JSON.stringify(data)).not.toContain(ALIAS_ORIGIN);
  });

  it('falls back to the request origin when no canonical is configured', () => {
    // The zero-config fork path: an instance with no domain still ships a
    // coherent entity graph anchored to wherever it is actually served.
    const bare = entityJsonLd('https://example.workers.dev');
    const org = JSON.parse(bare.match(/>(.*)</s)[1])['@graph']
      .find((n) => n['@type'] === 'Organization');
    const expected = siteConfig.url
      ? `${siteConfig.url.replace(/\/+$/, '')}/`
      : 'https://example.workers.dev/';
    expect(org.url).toBe(expected);
  });

  it('sameAs lists only live, crawlable profiles (no private repo URL)', () => {
    // Derived from config, not hardcoded: the engine ships an example config
    // with an empty sameAs, and this test travels with it. What must hold for
    // every instance is the *rule* — sameAs mirrors config exactly, carries
    // only absolute https URLs, and never leaks a pre-launch/private repo.
    const data = parseGraph(entityJsonLd(ALIAS_ORIGIN));
    const org = data['@graph'].find((n) => n['@type'] === 'Organization');
    const configured = siteConfig.entity.sameAs || [];

    expect(org.sameAs ?? []).toEqual(configured);
    for (const u of org.sameAs ?? []) {
      expect(u, `${u} must be an absolute https URL`).toMatch(/^https:\/\//);
    }
  });

  it('declares the engine only when config names a repository', () => {
    // This replaced a pre-launch assertion that the graph must never contain
    // "oaklens-os", which was true only while that repo was private and became
    // false the day it opened. What actually has to hold forever is that the
    // node is CONFIG-DERIVED: src/shared/site.js ships to every fork, so a
    // hardcoded repo URL would have every fork's homepage telling crawlers its
    // source code lives in somebody else's repository — and no leak scan would
    // catch it, because a GitHub org slug is not the wordmark.
    const node = parseGraph(entityJsonLd(ALIAS_ORIGIN))['@graph']
      .find((n) => n['@type'] === 'SoftwareSourceCode');
    const configured = siteConfig.entity.codeRepository;

    if (!configured) {
      expect(node, 'no configured repository must mean no node').toBeUndefined();
      return;
    }
    expect(node.codeRepository).toBe(configured);
    expect(configured, 'a declared repository must be an absolute https URL')
      .toMatch(/^https:\/\//);
    expect(node.author['@id']).toContain('#organization');
  });

  it('keeps personal identity out of the public entity', () => {
    const blob = entityJsonLd(ALIAS_ORIGIN);
    expect(blob).not.toContain(siteConfig.email);
  });

  it('escapes < so markup cannot break out of the script tag', () => {
    expect(entityJsonLd(ALIAS_ORIGIN)).not.toMatch(/<\/script>.*<\/script>/s);
  });
});
