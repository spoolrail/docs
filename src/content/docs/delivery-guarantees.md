---
title: Delivery Guarantees
---

By default, Spoolrail delivers every published message <strong class="text-highlight">once</strong> and <strong class="text-highlight">in order</strong> to each subscription's Laravel queue. This guarantee covers ordinary publication and broker redeliveries.

AWS SNS/SQS and Google Pub/Sub let you trade one or more guarantees for higher throughput. See [AWS standard mode](/snssqs/#standard-mode), [Pub/Sub message ordering](/pubsub/#message-ordering), and [Pub/Sub exactly-once delivery](/pubsub/#exactly-once-delivery) for those settings.

## What the Guarantee Covers

The guarantee ends when the selected Laravel queue accepts the message. From that point, Laravel queue owns handler execution, retries, timeouts, and terminal failure.

Spoolrail preserves handoff order from the broker to Laravel queue within an ordering group. Whether handlers execute and complete in that order depends on Laravel queue concurrency and retries.

## When a Handler Can Repeat

While unlikely, a duplicate handoff is still possible. For example, the broker might accept an outbox publication without returning confirmation because of a network issue or crash. If the dispatcher stays down until the [handoff idempotency window](consumers.md#message-delivery) expires, its next attempt can hand off the message again.

Separately, and independent of Spoolrail, Laravel queue may re-run a handler when it fails partway and is retried. Where repeating a handler's effect would cause harm, consider making the handler's work idempotent.
