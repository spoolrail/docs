---
title: Testing
---

## Using the Array Connection

The `array` connection keeps messages in memory for the current PHP process:

```php
config([
    'spoolrail.default' => 'array',
    'spoolrail.handoff_idempotency.cache_store' => 'array',
    'queue.default' => 'sync',
]);
```

This sends messages through the in-memory Spoolrail connection, keeps handoff idempotency state in memory, and runs handlers through Laravel's synchronous queue connection.

Declare subscriptions before publishing. Publish and consume in the same test process; a separate `php artisan` process cannot see the in-memory messages.

On the array connection, `spoolrail` with an explicit subscription returns after it drains that subscription's buffered messages. All-subscription supervision is unavailable because a clean child process cannot observe messages buffered in the test process.

## Testing a Handler

This Pest test uses the application's real `warehouse-orders` subscription:

```php
use App\Services\Inventory;
use Spoolrail\Spoolrail\Facades\Spoolrail;
use Spoolrail\Spoolrail\Message;

test('reserves inventory for an order message', function (): void {
    config([
        'spoolrail.default' => 'array',
        'spoolrail.handoff_idempotency.cache_store' => 'array',
        'queue.default' => 'sync',
    ]);

    $inventory = Mockery::mock(Inventory::class);
    $inventory->shouldReceive('reserve')
        ->once()
        ->with(42);

    app()->instance(Inventory::class, $inventory);

    Spoolrail::publish(
        'orders',
        Message::make('order.created', [
            'order_id' => 42,
        ]),
    );

    $this->artisan('spoolrail', [
        'subscription' => 'warehouse-orders',
    ])->assertSuccessful();
});
```

## Testing Queued Handling

When a subscription uses an asynchronous queue connection:

1. publish through the array Spoolrail connection;
2. run `spoolrail` with the subscription name;
3. run a Laravel queue worker for the selected connection and queue; and
4. assert the handler's domain effect.

Use transport-backed integration tests when behavior depends on native acceptance, delivery, settlement, or topology. For AWS SNS/SQS tests, point a test connection at a local AWS-compatible endpoint such as MiniStack.

For Google Pub/Sub tests, start the Pub/Sub emulator and expose its standard environment variable to the PHP process:

```dotenv
GOOGLE_CLOUD_PROJECT=spoolrail-test
PUBSUB_EMULATOR_HOST=127.0.0.1:8085
```

Leave the Pub/Sub connection's `credentials` setting `null`. Spoolrail follows `PUBSUB_EMULATOR_HOST` without requiring emulator credentials or a custom endpoint. Use the emulator to test publication, pull delivery, acknowledgment, fanout, and topology. It cannot verify production ordering or exactly-once guarantees.
