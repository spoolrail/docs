# Transactional Outbox

Spoolrail publishes directly to the selected broker connection by default. Enable the transactional outbox when a database change and its publication must commit or roll back together.

> [!NOTE]
> The transactional outbox is optional. It coordinates publication with a database transaction; it is not a general fault-tolerance measure. See [Publication Retries](messages.md#publication-retries) for handling transient broker failures.

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

The transaction commits or rolls back the outbox record with the application changes. The later publication retains its headers and ordering key. If the outbox uses a different database connection, set `SPOOLRAIL_OUTBOX_DATABASE_CONNECTION` to its Laravel connection name and start the transaction on that connection.

## Scheduling Publication

Run pending publications with:

```bash
php artisan spoolrail:publish
```

The dispatcher publishes serially in a single process by default. Increase the outbox concurrency setting to publish several topics at once while **preserving publication order within each topic**:

```dotenv
SPOOLRAIL_OUTBOX_CONCURRENCY=4
```

With concurrency `4`, Spoolrail starts up to four workers and distributes all topics with pending publications across them. A worker may handle several topics during the invocation, one publication at a time. The workers publish in parallel. If only one topic has pending publications, Spoolrail starts one worker.

Schedule the command often enough to meet the application's latency requirement. A low-latency definition in `routes/console.php` can run every second:

```php
use Illuminate\Support\Facades\Schedule;

Schedule::command('spoolrail:publish')
    ->everySecond()
    ->runInBackground()
    ->withoutOverlapping();
```

> [!NOTE]
> When using sub-minute scheduled tasks, run `php artisan schedule:interrupt` after each deployment so the scheduler loads the new code on its next invocation.

Each invocation works through the rows visible when it starts and then exits. Rows committed during the run wait for the next invocation.

When the command receives `SIGINT`, `SIGTERM`, or `SIGQUIT`, each publisher finishes its current publication, starts no new work, and exits. In concurrent mode, the command waits for all workers. The maximum wait depends on broker timeouts and your process monitor's shutdown timeout.

## Failure and Recovery

Spoolrail applies its bounded publication retries during each dispatcher run. If those retries are exhausted, the publication remains in the outbox for the next scheduled run.

A failing publication blocks later publications for the same topic on that broker connection, while other publications continue. The command exits non-zero if any attempted publication fails or has an uncertain outcome.

If a concurrent worker exits unexpectedly, the other workers finish without replacing it. The command exits non-zero, and every row the failed worker did not remove remains pending for the next invocation.

The retained row records a short `last_error`, and its `updated_at` value shows when it was last attempted. Spoolrail also reports the failure through Laravel's exception handler. By default, it reports failures for the same row at most once every five minutes:

```php
'outbox' => [
    'enabled' => env('SPOOLRAIL_OUTBOX', false),
    'database_connection' => env('SPOOLRAIL_OUTBOX_DATABASE_CONNECTION', env('DB_CONNECTION', 'sqlite')),
    'concurrency' => env('SPOOLRAIL_OUTBOX_CONCURRENCY', 1),
    'exception_cooldown' => 300,
],
```

A later successful attempt deletes the row and writes a recovery message at `notice` level.

Spoolrail does not discard a publication after a fixed number of attempts. Persistent failures remain visible until you fix their cause.

## Changing Broker Connections

Each outbox row retains the Spoolrail connection name selected when it was staged. The dispatcher resolves that name from current configuration.

When moving to another broker connection, give the new connection a new name and direct new publications to it. Keep the old connection configured until you publish or otherwise handle its outbox rows. Reusing the old name for new driver settings would route pending rows through those settings.
