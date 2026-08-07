# Testing

## Using the Array Connection

The `array` connection keeps messages in memory for the current PHP process:

```php
config([
    'spoolrail.default' => 'array',
    'spoolrail.handoff_idempotency.cache_store' => 'array',
    'queue.default' => 'sync',
]);
```

Declare subscriptions before publishing. Publish and consume in the same test process; a separate `php artisan` process cannot see the in-memory messages.

On the array connection, `spoolrail:consume` returns after it drains the subscription's buffered messages.

## Testing a Handler

The following Pest test uses the application's real `warehouse-orders` subscription:

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

    Spoolrail::forgetConnection();

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

    $this->artisan('spoolrail:consume', [
        'subscription' => 'warehouse-orders',
    ])->assertSuccessful();
});
```

Call `Spoolrail::forgetConnection()` after changing connection configuration if the connection may already have been resolved.

## Testing Queued Handling

When a subscription uses an asynchronous Queue connection:

1. publish through the array Spoolrail connection;
2. run `spoolrail:consume`;
3. run a Laravel queue worker for the selected connection and queue; and
4. assert the handler's domain effect.

Use RabbitMQ integration tests when the behavior under test depends on broker confirmation, prefetch, acknowledgements, topology, or Management API permissions.
