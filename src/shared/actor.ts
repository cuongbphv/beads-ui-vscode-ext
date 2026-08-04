/**
 * Who "you" are.
 *
 * beads stamps an actor on every write and resolves it from, in order: the
 * `--actor` flag, `BEADS_ACTOR`, the deprecated `BD_ACTOR`, `git config
 * user.name`, `$USER`, then the literal "unknown". The sidebar's "Needs You"
 * section is only trustworthy if it answers with the *same* name bd would
 * write, so this mirrors that chain rather than inventing one.
 *
 * Pure on purpose: the extension host reads the environment and git, this file
 * only decides. That keeps `shared/` framework-free and the precedence testable
 * without spawning anything.
 */

/** bd's placeholder when it cannot identify anyone — never a real assignee. */
const UNKNOWN = 'unknown';

/** Candidate identities, highest precedence first. */
export interface ActorSources {
  /** `beadsDashboard.assignee` — an explicit override for when bd guesses wrong. */
  setting?: string;
  beadsActorEnv?: string;
  /** Deprecated in bd, still honoured because bd still honours it. */
  bdActorEnv?: string;
  gitUserName?: string;
  osUser?: string;
}

/** Trim and drop the values that carry no identity. */
export function normalizeActor(name: string | undefined | null): string | undefined {
  const trimmed = name?.trim();
  if (!trimmed || trimmed.toLowerCase() === UNKNOWN) return undefined;
  return trimmed;
}

/**
 * The first source that names somebody, or `undefined` when nothing does —
 * bd's "unknown" is deliberately not propagated, because a section headed
 * "Needs You" listing another machine's `unknown` work would be a lie.
 */
export function resolveActor(sources: ActorSources): string | undefined {
  return (
    normalizeActor(sources.setting) ??
    normalizeActor(sources.beadsActorEnv) ??
    normalizeActor(sources.bdActorEnv) ??
    normalizeActor(sources.gitUserName) ??
    normalizeActor(sources.osUser)
  );
}

/**
 * Do two identities refer to the same person?
 *
 * Case- and whitespace-insensitive: an assignee typed by hand as `cuong bui`
 * and one claimed by bd as `Cuong Bui` are the same human, and treating them as
 * two people is exactly the kind of quiet mis-bucketing that makes a "mine"
 * view useless.
 */
export function isSameActor(a: string | undefined, b: string | undefined): boolean {
  const left = normalizeActor(a);
  const right = normalizeActor(b);
  if (!left || !right) return false;
  return left.toLowerCase() === right.toLowerCase();
}
