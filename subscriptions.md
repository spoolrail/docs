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

Spoolrail loads this file when the application boots. Run `php artisan spoolrail:sync` after changing declarations so RabbitMQ can create any missing resources.

Each subscription receives its own copy of every message published to its topic:

```php
Spoolrail::subscribe('orders', 'warehouse-orders', ReserveInventory::class);
Spoolrail::subscribe('orders', 'analytics-orders', RecordOrderAnalytics::class);
```

Subscription names follow the same character rules as [topic names](messages.md#topic-names), contain at most 50 characters, and must be unique across the application, including subscriptions on different connections.

> The 50-character limit leaves enough room for the ownership prefix and `.fifo` suffix within AWS SQS's 80-character queue name limit.

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

Use the message UUID as an idempotency key when the handler performs a side effect that must not repeat.

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

## Adding or Removing a Subscription

To add a subscription:

1. deploy its handler and declaration;
2. run `php artisan spoolrail:sync`; and
3. start its `spoolrail:consume` process.

To remove one:

1. stop its consumer;
2. remove its declaration and deploy; and
3. delete the old RabbitMQ queue only after its remaining messages are no longer needed.

See [Removing Subscriptions](rabbitmq.md#removing-subscriptions) for the cleanup command.

## Moving a Subscription

Changing a subscription's topic or Spoolrail connection does not update its existing RabbitMQ queue. To preserve messages, deploy a replacement under a new subscription name, run `spoolrail:sync`, start its consumer, move publishers when the topic changes, and keep the old declaration and consumer until its RabbitMQ queue drains. Then remove the old declaration and clean up its queue on the connection that owns it. If Laravel jobs can still run under the old name, replace the old declaration with the rename mapping below when retiring its RabbitMQ queue.

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
