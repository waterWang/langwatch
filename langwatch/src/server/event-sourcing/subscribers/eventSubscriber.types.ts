import type { Event } from "../domain/types";
import type { DeduplicationStrategy } from "../queues/queue.types";

/** Metadata available to an event-only subscriber. Fold state is deliberately absent. */
export interface EventSubscriberContext {
  tenantId: string;
  aggregateId: string;
}

/**
 * Enqueue-time hook evaluated at fan-out — in the routing worker, while the
 * committed event is already in memory — BEFORE any subscriber job is staged
 * (payload-cost doctrine invariant 4 — ADR-069).
 *
 * The hook runs on the routing/dispatch path, so it shares its failure
 * contract: a throw propagates into the routing retry (the committed event's
 * subscriber fan-out is retried), it is NEVER swallowed into a silent drop.
 * Keep it cheap and total — anything data-dependent or expensive belongs in
 * the handler's own consumer lane, where a failure retries only that
 * subscriber's job.
 */
export interface EnqueueDispatchOptions<E extends Event = Event> {
  /**
   * Predicate deciding whether a job is staged at all. `false` → no job is ever
   * minted for this event (the cheapest job is the one that never exists). A
   * throw is NOT treated as `false`: it fails loudly into the routing retry.
   */
  filter?: (event: E) => boolean;
  /**
   * Claim-check staging (ADR-069): swap the staged payload for a small
   * reference event that mirrors the source event's scheduling identity (id,
   * aggregate, tenant, occurredAt) while the payload stays in its canonical
   * store. Total field-picks only — no decoding, no normalization; return the
   * source event unchanged when a reference cannot be built. The handler must
   * understand every shape this can return, plus the full event (pre-upgrade
   * jobs). Runs after `filter` accepted the event; a throw fails loudly into
   * the routing retry.
   */
  stage?: (event: E) => Event;
}

export interface EventSubscriberOptions<E extends Event = Event> {
  disabled?: boolean;
  delay?: number;
  deduplication?: DeduplicationStrategy<E>;
  groupKeyFn?: (event: E) => string;
  /**
   * Enqueue-time filter (ADR-069): declined events never mint a job. During a
   * rolling deploy, jobs staged by a build without the filter can still be in
   * the queue — a handler must stay correct for events its filter would have
   * declined.
   */
  enqueue?: EnqueueDispatchOptions<E>;
}

/**
 * A live consumer of an event that has already been stored in the canonical
 * event log. The same event is carried through GroupQueue; subscribers do not
 * load it back from the event store and are not invoked by projection replay.
 *
 * Durable subscribers must make their own handling idempotent. Process
 * managers do that with their transactional inbox.
 */
export interface EventSubscriberDefinition<E extends Event = Event> {
  name: string;
  /** Empty means all event types. */
  eventTypes: readonly string[];
  handle: (event: E, context: EventSubscriberContext) => Promise<void>;
  options?: EventSubscriberOptions<E>;
}
