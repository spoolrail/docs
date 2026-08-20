---
title: Delivery Guarantees
description: Understand what Spoolrail's once-and-ordered handoff guarantee covers and when a handler can still repeat.
---

By default, Spoolrail delivers every published message <strong class="text-highlight">once</strong> and <strong class="text-highlight">in order</strong> to each subscription's Laravel queue. This guarantee covers ordinary publication and broker redeliveries.

AWS SNS/SQS and Google Pub/Sub let you trade one or more guarantees for higher throughput. See [AWS standard mode](/snssqs/#standard-mode), [Pub/Sub message ordering](/pubsub/#message-ordering), and [Pub/Sub exactly-once delivery](/pubsub/#exactly-once-delivery) for those settings.

## What the Guarantee Covers

The guarantee ends when the selected Laravel queue accepts the message. From that point, Laravel queue owns handler execution, retries, timeouts, and terminal failure.

Ordering also ends at queue handoff. Spoolrail preserves handoff order from the broker to Laravel queue within an ordering group, but Laravel queue concurrency and retries may change handler execution or completion order.

## When a Handler Can Repeat

An uncertain publication can create a duplicate. For example, the broker might accept an outbox publication without returning confirmation because of a network issue or crash. Spoolrail retains or retries the publication because it cannot know whether the broker accepted it.

Spoolrail [deduplicates recent repeats during queue handoff](/consumers/#message-delivery). If the dispatcher stays down until that idempotency window expires, its next attempt can hand off the message again.

Separately, Laravel queue may run a handler again when it fails partway and is retried. This can happen even when Spoolrail handed the message to Laravel queue only once.

## Protecting Handler Effects

Make a handler idempotent when repeating its effect would cause harm. The message UUID remains the same across Spoolrail publication retries and Laravel queue retries, so `$message->id` can identify work the application has already applied.
