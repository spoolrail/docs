# Transactional Outbox

Spoolrail publishes directly to the selected broker connection by default. Enable the transactional outbox when a database change and its publication must commit or roll back together.

The policy applies to every Spoolrail publication in the application. Existing publishing code keeps using `Spoolrail::publish(...)` or `Spoolrail::connection(...)->publish(...)`.

## Enabling the Outbox

Publish the package config and outbox migration:

```bash
php artisan vendor:publish --tag=spoolrail-config
php artisan vendor:publish --tag=spoolrail-migrations
```

Run the published migration, then enable the policy:

```bash
php artisan migrate
```

```dotenv
SPOOLRAIL_OUTBOX=true
```

Direct-only applications do not need the outbox migration.

## Publishing Atomically

Write application state and publish from the same database transaction:

```php
use Illuminate\Support\Facades\DB;
use Spoolrail\Spoolrail\Facades\Spoolrail;
use Spoolrail\Spoolrail\Message;

DB::transaction(function () use ($order): void {
    $order->markAsSubmitted();
    $order->save();

    Spoolrail::publish(
        'orders',
        Message::make('order.submitted', [
            'order_id' => $order->id,
        ]),
    );
});
```

The outbox record commits and rolls back with that transaction. Any headers and ordering key are preserved when the message is published later. If you configure the outbox to use another database connection, start the transaction on that connection.

## Scheduling Publication

Run pending publications with:

```bash
php artisan spoolrail:publish
```

Schedule the finite command at the latency your application needs. A low-latency definition in `routes/console.php` can run every second:

```php
use Illuminate\Support\Facades\Schedule;

Schedule::command('spoolrail:publish')
    ->everySecond()
    ->runInBackground()
    ->withoutOverlapping();
```

> **Deployment requirements:** Operate exactly one active outbox dispatcher across the entire deployment, including multi-server setups.
>
> When using sub-minute scheduled tasks, run `php artisan schedule:interrupt` after each deployment so the scheduler loads the new code on its next invocation.

Each invocation works through the rows visible when it starts and then exits. Rows committed during the run wait for the next invocation.

`SIGINT`, `SIGTERM`, or `SIGQUIT` lets the command finish the publication already in progress and exit before starting another.

## Failure and Recovery

A failed or uncertain publication remains in the outbox and is retried on the next scheduled run. Scheduler cadence is retry cadence.

Within each broker connection and topic, pending publications are handled oldest first. A failing row blocks later rows for that same connection and topic, while unrelated topics and connections continue. The command exits non-zero if any attempted publication fails or has an uncertain outcome.

The retained row records a short `last_error`, and its `updated_at` value shows when it was last attempted. Spoolrail also reports the contextual exception through Laravel's exception handler. Repeated reports for the same row are limited to one every five minutes by default:

```php
'outbox' => [
    'enabled' => env('SPOOLRAIL_OUTBOX', false),
    'connection' => env('SPOOLRAIL_OUTBOX_CONNECTION', env('DB_CONNECTION', 'sqlite')),
    'exception_cooldown' => 300,
],
```

A later successful attempt deletes the row and writes a recovery message at `notice` level.

Spoolrail does not discard a publication after a fixed number of attempts. Persistent failures remain visible and keep their connection-and-topic lane blocked until the underlying problem is corrected.

## Changing Broker Connections

Each outbox row retains the Spoolrail connection name selected when it was staged, and dispatch resolves that name from current configuration.

When moving from one broker connection to another, give the new connection a new name and direct new publications to it. Keep the old named connection configured until its outbox rows have been published or otherwise deliberately handled. Reusing the old name for new driver settings would also route its pending rows through those new settings.
