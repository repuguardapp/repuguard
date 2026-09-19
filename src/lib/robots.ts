/**
 * Whether a site's robots.txt lets us fetch a path.
 *
 * A compliance company that ignores robots.txt to run a compliance scan has
 * lost the argument before it starts. The file is the only machine-readable
 * statement a site makes about automated access, and reading it is one
 * request — the same reasoning as the sitemap: it exists to be read by
 * clients like ours.
 *
 * DELIBERATELY CONSERVATIVE, IN ONE DIRECTION
 *
 * This is not a full RFC 9309 implementation and does not try to be. Where
 * the standard is ambiguous or this parser is unsure, the answer is "not
 * allowed". A scan we did not run costs a page; a scan we ran against a
 * site's stated wishes costs the thing we sell.
 *
 * WHAT IT DOES IMPLEMENT
 *
 * Group selection by user-agent, longest-match precedence between Allow and
 * Disallow, `$` end-anchoring and `*` wildcards — the four rules that decide
 * almost every real case. Crawl-delay and Sitemap are read elsewhere.
 */

export interface RobotsRules {
  /** Rules for the most specific group that applies to us. */
  rules: { allow: boolean; pattern: string }[];
  /** True when robots.txt could not be read at all. */
  unknown: boolean;
}

/** How we identify ourselves. A contactable agent is refused less often. */
export const USER_AGENT = 'LexyFlowScan';

/**
 * Parse robots.txt into the rules that apply to us.
 *
 * Group selection follows the standard: the most specific matching
 * user-agent wins, and `*` is the fallback. A site that names us
 * specifically has gone to the trouble of having an opinion about us, and
 * it overrides the general rule in both directions.
 */
export function parseRobots(text: string): RobotsRules {
  const lines = text.split(/\r?\n/);

  const groups = new Map<string, { allow: boolean; pattern: string }[]>();
  let currentAgents: string[] = [];
  let expectingAgents = false;

  for (const raw of lines) {
    const line = raw.split('#')[0]!.trim();
    if (!line) continue;

    const colon = line.indexOf(':');
    if (colon === -1) continue;

    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === 'user-agent') {
      // Consecutive user-agent lines share one group of rules.
      if (!expectingAgents) currentAgents = [];
      currentAgents.push(value.toLowerCase());
      expectingAgents = true;
      continue;
    }

    if (field === 'allow' || field === 'disallow') {
      expectingAgents = false;
      for (const agent of currentAgents) {
        if (!groups.has(agent)) groups.set(agent, []);
        // An empty Disallow means "nothing is disallowed" and is not a rule.
        if (field === 'disallow' && value === '') continue;
        groups.get(agent)!.push({ allow: field === 'allow', pattern: value });
      }
    }
  }

  const ours = USER_AGENT.toLowerCase();
  // Most specific first: our own name, then any group whose token is a
  // prefix of it, then the wildcard.
  const named = [...groups.keys()].find((agent) => agent !== '*' && ours.includes(agent));

  return {
    rules: groups.get(named ?? '*') ?? [],
    unknown: false
  };
}

/**
 * May we fetch this path?
 *
 * Longest match wins, and Allow beats Disallow at equal length — the rule
 * every major crawler follows and the one site owners write against.
 */
export function isAllowed(path: string, robots: RobotsRules): boolean {
  // We could not read robots.txt. A site whose wishes we do not know is a
  // site we do not scan.
  if (robots.unknown) return false;

  let decision = true;
  let best = -1;

  for (const rule of robots.rules) {
    if (!matches(path, rule.pattern)) continue;

    // `$`-anchored and wildcard patterns are compared on their literal
    // length, which is what "longest match" means in practice.
    const length = rule.pattern.length;
    if (length > best || (length === best && rule.allow)) {
      best = length;
      decision = rule.allow;
    }
  }

  return decision;
}

function matches(path: string, pattern: string): boolean {
  if (pattern === '') return false;

  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;

  const segments = body.split('*');
  let cursor = 0;

  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i]!;
    if (segment === '') continue;

    if (i === 0) {
      // The first segment must sit at the start: robots patterns are
      // prefixes, not substrings.
      if (!path.startsWith(segment)) return false;
      cursor = segment.length;
      continue;
    }

    const found = path.indexOf(segment, cursor);
    if (found === -1) return false;
    cursor = found + segment.length;
  }

  if (anchored) {
    const tail = segments[segments.length - 1]!;
    return tail === '' ? true : path.endsWith(tail);
  }

  return true;
}
