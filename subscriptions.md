# Subscriptions and Handlers

## Declaring Subscriptions

Declare subscriptions in `routes/subscriptions.php`:

```php
use App\Spoolrail\Handlers\ReserveInventory;
use Spoolrail\Spoolrail\Facades\Spoolrail;

Spoolrail::subscribe(
    topic: 'orders',
    name: 'warehouse-orders',
    handler: ReserveInventory::class,
);
```

Spoolrail loads this file when the application boots.

Each subscription receives its own copy of every message published to its topic:

```php
Spoolrail::subscribe('orders', 'warehouse-orders', ReserveInventory::class);
Spoolrail::subscribe('orders', 'analytics-orders', RecordOrderAnalytics::class);
```

Subscription names follow the same character rules as [topic names](messages.md#topic-names), contain at most 50 characters, and must be unique across the application, including subscriptions on different connections.

> The 50-character limit leaves enough room for the ownership prefix and `.fifo` suffix within AWS SQS's 80-character queue name limit.

## Synchronizing Topology

Subscription declarations are the source for managed broker topology. Publishing and consuming do not create broker resources.

Run the synchronization command after deploying declaration changes:

```bash
php artisan spoolrail:sync
```

Spoolrail inspects every referenced managed connection before applying any changes, so an inspection failure changes nothing. A successful synchronization creates missing compatible resources and relationships, but does not convert, replace, or delete existing resources.

Resource creation is not transactional. If a broker, service, or network failure interrupts synchronization, correct the failure and rerun the command; compatible resources already created are reused.

A publisher-only application cannot establish a new topic by publishing. Synchronize at least one receiving application before enabling publication to that topic.

The [RabbitMQ](rabbitmq.md#managed-topology) and [AWS SNS/SQS](aws.md#managed-topology) guides describe how subscription declarations map to native resources and which management credentials they require.

## Removing Resources

Removing a subscription declaration does not delete its broker resource. Until that resource is deleted, it may continue collecting messages from its topic. Once it is drained or its remaining messages may be discarded, delete undeclared subscription resources:

```bash
php artisan spoolrail:delete-undeclared-subscriptions
```

Each deletion command targets the default Spoolrail connection unless you pass a configured name such as `--connection=events`. The command permanently deletes each undeclared receive resource, its buffered messages, and its routing from the topic.

After changing the application's ownership prefix, delete every subscription resource under the former prefix with:

```bash
php artisan spoolrail:delete-undeclared-subscriptions --retired-prefix=warehouse-staging
```

The current ownership prefix cannot be supplied as retired.

Delete an unused topic explicitly:

```bash
php artisan spoolrail:delete-topic orders
```

The command deletes only a compatible unused topic. Deletion is refused while bindings or subscriptions remain, and it never deletes subscription resources.

## Writing a Handler

Handlers are concrete classes implementing `MessageHandler`. Laravel resolves them through the service container when a queue worker runs them:

```php
<?php

declare(strict_types=1);

namespace App\Spoolrail\Handlers;

use App\Services\Inventory;
use Spoolrail\Spoolrail\Contracts\MessageHandler;
use Spoolrail\Spoolrail\Message;

class ReserveInventory implements MessageHandler
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

## Choosing the Transport and Queue

A subscription can select its Spoolrail connection, Laravel Queue connection, and Laravel queue independently:

```php
Spoolrail::subscribe('orders', 'priority-orders', HandlePriorityOrder::class)
    ->onConnection('rabbitmq-secondary')
    ->onQueueConnection('redis')
    ->onQueue('broker-priority');
```

- `onConnection` chooses the Spoolrail transport.
- `onQueueConnection` chooses the Laravel Queue connection.
- `onQueue` chooses the queue within that Laravel connection.

Omitted values use the corresponding application defaults.

### Using the Sync Queue Connection

With Laravel's `sync` Queue connection, Spoolrail runs the handler before telling the broker that the delivery is complete. If the handler throws or consumption is interrupted first, Spoolrail does not acknowledge the delivery, so the broker may deliver the same message again.

Prefer an asynchronous Queue connection in production. Spoolrail can acknowledge the broker delivery as soon as Laravel Queue accepts the message, while Laravel Queue takes responsibility for running the handler and managing retries, timeouts, concurrency, and terminal failures.

## Queue Attempts, Timeouts, and Middleware

Declare Laravel Queue behavior on the handler:

```php
use DateTimeInterface;
use Illuminate\Queue\Middleware\WithoutOverlapping;

class ReserveInventory implements MessageHandler
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

Prefer methods when attempts or backoff are dynamic. Spoolrail captures Queue policy and middleware when it hands the message to Laravel Queue, before the handler constructor runs. Changes apply only to messages handed off afterward; existing queued jobs keep their captured policy.

## Handling Terminal Failures

A handler may define a `failed` method for message-specific cleanup or reporting. Spoolrail calls this method once after the queue marks the handler's job as failed. This works similarly to Laravel's queued jobs and listeners.

```php
use Spoolrail\Spoolrail\Message;
use Throwable;

public function failed(Message $message, ?Throwable $exception): void
{
    // ...
}
```

> A new instance of the handler is instantiated before invoking the `failed` method; therefore, any class property modifications that may have occurred within the `handle` method will be lost.

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
4. Remove the original declaration. If Laravel Queue may still contain jobs for its name, add the mapping described in [Renaming a Subscription](#renaming-a-subscription) to the replacement at the same time.
5. [Remove the original RabbitMQ subscription resource](#removing-resources) from its original connection.

## Renaming a Subscription

Laravel jobs already waiting for a subscription use its registered name when they run. Preserve those jobs by mapping the former name to the replacement:

```php
Spoolrail::subscribe(
    'orders',
    'warehouse-orders-v2',
    ReserveInventoryV2::class,
)->drainMessagesQueuedFor('warehouse-orders');
```

The former name becomes reserved and cannot also be an active subscription.

This mapping applies only to work already handed to Laravel Queue. It does not move messages still buffered in the old RabbitMQ queue. Drain that queue with the old consumer, or explicitly decide to discard it, before running the subscription cleanup command.

Keep the mapping until every queued, delayed, retryable, in-flight, or failed Laravel job using the former name has completed or been discarded.
