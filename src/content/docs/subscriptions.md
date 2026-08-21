---
title: Subscriptions and Handlers
---

## Declaring Subscriptions

Declare subscriptions in `routes/subscriptions.php`:

```php
use App\Messages\ReserveInventoryHandler;
use Spoolrail\Spoolrail\Facades\Spoolrail;

Spoolrail::subscribe(
    topic: 'orders',
    name: 'warehouse-orders',
    handler: ReserveInventoryHandler::class,
);
```

Spoolrail loads this file when the application boots.

Each subscription receives its own copy of every message published to its topic:

```php
Spoolrail::subscribe('orders', 'warehouse-orders', ReserveInventoryHandler::class);
Spoolrail::subscribe('orders', 'analytics-orders', RecordOrderAnalyticsHandler::class);
```

Subscription names follow the same character rules as [topic names](/messages/#topic-names), contain at most 50 characters, and must be unique across the application, including subscriptions on different connections.

> The 50-character limit leaves enough room for the ownership prefix and `.fifo` suffix within AWS SQS's 80-character queue name limit.

## Synchronizing Topology

Subscription declarations are the source for managed broker topology. Publishing and consuming do not create broker resources.

Run the synchronization command after deploying declaration changes:

```bash
php artisan spoolrail:sync
```

Spoolrail inspects every referenced managed connection before applying any changes, so an inspection failure changes nothing. A successful synchronization creates missing compatible resources and relationships, but does not convert, replace, or delete existing resources.

Resource creation is not transactional. Spoolrail retries short-lived service and rate-limit failures. After a partially applied attempt, both recovery and a later `spoolrail:sync` run read current broker state and apply only what remains.

A publisher-only application cannot establish a new topic by publishing. Synchronize at least one receiving application before enabling publication to that topic.

The [RabbitMQ](/rabbitmq/#managed-topology), [AWS SNS/SQS](/snssqs/#managed-topology), and [Google Pub/Sub](/pubsub/#managed-topology) guides describe how subscription declarations map to native resources and which management credentials they require.

## Removing Resources

Removing a subscription declaration does not delete its broker resource. The resource may continue collecting messages from its topic until you delete it. After draining its messages or deciding to discard them, delete undeclared subscription resources:

```bash
php artisan spoolrail:delete-undeclared-subscriptions
```

Each deletion command targets the default Spoolrail connection unless you pass a configured name such as `--connection=events`. The command permanently deletes each undeclared receive resource, its buffered messages, and its routing from the topic.

After changing the application's ownership prefix, delete every subscription resource under the former prefix with:

```bash
php artisan spoolrail:delete-undeclared-subscriptions --retired-prefix=warehouse-legacy
```

You cannot pass the current ownership prefix to `--retired-prefix`.

Delete an unused topic:

```bash
php artisan spoolrail:delete-topic orders
```

The command deletes only a compatible unused topic. Spoolrail refuses the deletion while bindings or subscriptions remain, and the command never deletes subscription resources.

## Writing a Handler

Handlers are concrete classes implementing `MessageHandler`. Laravel resolves them through the service container when a queue worker runs them:

```php
<?php

namespace App\Messages;

use App\Services\Inventory;
use Spoolrail\Spoolrail\Contracts\MessageHandler;
use Spoolrail\Spoolrail\Message;

class ReserveInventoryHandler implements MessageHandler
{
    public function __construct(
        private readonly Inventory $inventory,
    ) {}

    public function handle(Message $message): void
    {
        $this->inventory->reserve(
            (int) $message->payload['order_id'],
        );
    }
}
```

## Choosing the transport and queue

A subscription can select its Spoolrail connection, Laravel queue connection, and Laravel queue independently:

```php
Spoolrail::subscribe('orders', 'priority-orders', ProcessPriorityOrderHandler::class)
    ->onConnection('rabbitmq-secondary')
    ->onQueueConnection('redis')
    ->onQueue('broker-priority');
```

- `onConnection` chooses the Spoolrail transport.
- `onQueueConnection` chooses the Laravel queue connection.
- `onQueue` chooses the queue within that Laravel connection.

Omitted values use the corresponding application defaults.

### Using the sync queue connection

With Laravel's `sync` queue connection, Spoolrail runs the handler before telling the broker that the delivery is complete. If the handler throws or consumption is interrupted first, Spoolrail does not acknowledge the delivery, so the broker may deliver the same message again.

Prefer an asynchronous queue connection in production. Spoolrail can acknowledge the broker delivery as soon as Laravel queue accepts the message, while Laravel queue takes responsibility for running the handler and managing retries, timeouts, concurrency, and terminal failures.

## Configuring queue attempts, timeouts, and middleware

Declare Laravel queue behavior on the handler:

```php
use DateTimeInterface;
use Illuminate\Queue\Middleware\WithoutOverlapping;

class ReserveInventoryHandler implements MessageHandler
{
    public int $tries = 5;

    public int $timeout = 120;

    public function backoff(): array
    {
        return [10, 30, 60];
    }

    public function retryUntil(): DateTimeInterface
    {
        return now()->addMinutes(15);
    }

    public function middleware(Message $message): array
    {
        return [
            new WithoutOverlapping($message->id),
        ];
    }

    public function handle(Message $message): void
    {
        // ...
    }
}
```

Spoolrail supports `tries`, `backoff`, `maxExceptions`, `timeout`, and `failOnTimeout` properties; `tries()`, `backoff()`, and `retryUntil()` methods; and a `middleware(Message $message)` method. Laravel 13 queue policy attributes are also supported.

Prefer methods when attempts or backoff are dynamic. Spoolrail captures queue policy and middleware when it hands the message to Laravel queue, before the handler constructor runs. Changes apply only to messages handed off afterward; existing queued jobs keep their captured policy.

## Handling Terminal Failures

A handler may define a `failed` method for message-specific cleanup or reporting. Spoolrail calls it once after the queue marks the handler's job as failed.

```php
use Spoolrail\Spoolrail\Message;
use Throwable;

public function failed(Message $message, ?Throwable $exception): void
{
    // ...
}
```

> Spoolrail creates a new handler instance before it calls `failed`. Changes that `handle` made to class properties are unavailable.

You can also register a `Queue::failing` callback in service provider for application-wide failure reporting:

```php
use Illuminate\Queue\Events\JobFailed;
use Illuminate\Support\Facades\Queue;
use Spoolrail\Spoolrail\Jobs\HandleMessageJob;

Queue::failing(function (JobFailed $event): void {
    if ($event->job->resolveQueuedJobClass() !== HandleMessageJob::class) {
        return;
    }

    // Handle event...
});
```

## Moving a Subscription

A RabbitMQ subscription queue remains on the connection and topic where it was created. To move a subscription without losing messages, replace it in stages:

1. Add a replacement subscription with a new name and the desired topic and Spoolrail connection. Keep the original subscription declared.
2. Update publishers to use the replacement's topic and Spoolrail connection.
3. Keep the original subscription running until its RabbitMQ queue is empty.
4. Remove the original declaration. If Laravel queue may still contain jobs for its name, add the mapping described in [Renaming a Subscription](#renaming-a-subscription) to the replacement at the same time.
5. [Remove the original RabbitMQ subscription resource](#removing-resources) from its original connection.

## Renaming a Subscription

Laravel jobs already waiting for a subscription use its registered name when they run. Preserve those jobs by mapping the former name to the replacement:

```php
Spoolrail::subscribe(
    'orders',
    'warehouse-orders-v2',
    ReserveInventoryV2Handler::class,
)->drainMessagesQueuedFor('warehouse-orders');
```

The former name becomes reserved and cannot also be an active subscription.

This mapping applies only to work already handed to Laravel queue. It does not move messages still buffered in the old RabbitMQ queue. Drain that queue with the old consumer, or decide to discard it, before running the subscription cleanup command.

Keep the mapping until every queued, delayed, retryable, in-flight, or failed Laravel job using the former name has completed or been discarded.
