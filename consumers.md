# Running Consumers

## Starting a Subscription Consumer

Run one consumer for each active subscription:

```bash
php artisan spoolrail:consume warehouse-orders
```

The consumer places messages on the Laravel Queue selected by the subscription. If that connection is asynchronous, run a Laravel queue worker as well:

```bash
php artisan queue:work redis --queue=broker-priority
```

The worker's connection and queue must match `onQueueConnection` and `onQueue`. RabbitMQ subscriptions may be processed by multiple `spoolrail:consume` processes when you need more throughput.

## Handler Failures

With an asynchronous Laravel Queue connection, a successful Queue push completes the broker delivery. Handler exceptions are then retried and recorded as failed jobs by Laravel Queue; they do not cause RabbitMQ to send the original delivery again.

Listen for Laravel's `JobFailed` event when the application needs a terminal-failure hook.

With Laravel's `sync` Queue connection, the handler runs before the broker delivery completes. A handler exception leaves the message available for another consume attempt.

Use an asynchronous Laravel Queue for long-running handlers. With RabbitMQ and the `sync` Queue, handler execution prevents the AMQP client from servicing heartbeats until the handler returns. If the negotiated heartbeat or broker consumer acknowledgement timeout is exceeded, RabbitMQ may close the connection and deliver the message again.

If a consumer loses its broker connection or cannot hand a message to Laravel Queue, it exits with an error and the message remains available. Run consumers under a process monitor so they restart.

## Process Management

A minimal Supervisor entry for one subscription may look like:

```ini
[program:spoolrail-warehouse-orders]
command=php /var/www/example.com/artisan spoolrail:consume warehouse-orders
directory=/var/www/example.com
user=forge
autostart=true
autorestart=true
stopasgroup=true
killasgroup=true
redirect_stderr=true
stdout_logfile=/var/log/supervisor/spoolrail-warehouse-orders.log
stopwaitsecs=3600
```

Create an entry for every subscription, or generate equivalent processes with your deployment platform.

Consumers and Laravel queue workers are long-lived. Restart both after deploying subscription, handler, or configuration changes. Use `queue:restart` for Laravel workers and your process monitor for `spoolrail:consume`.

## Duplicate Handling

A failure after Laravel Queue accepts work but before the broker records completion can place the same message on Laravel Queue more than once. Spoolrail suppresses repeated handling by subscription and message UUID.

The default configuration is:

```php
'deduplication' => [
    'enabled' => env('SPOOLRAIL_DEDUPLICATION', true),
    'store' => env('SPOOLRAIL_DEDUPLICATION_STORE', env('CACHE_STORE', 'database')),
    'remember' => 86400,
    'lock' => 300,
],
```

Choose a cache store that supports atomic locks and is shared by every worker that handles the subscription:

```dotenv
SPOOLRAIL_DEDUPLICATION_STORE=redis
```

Set `remember` long enough to cover the period in which a broker or queue retry can return. Set `lock` longer than the slowest legitimate handler execution. Spoolrail extends the lock to at least the handler's declared timeout plus a shutdown margin.

Deduplication is bounded. A handler may run again after the remember period, after a cache flush, or when a worker crashes after performing its side effect but before completion is recorded. Domain changes that must happen once still need an application-owned idempotency key.

Disable deduplication only when every handler already provides that boundary or every delivery must be handled:

```dotenv
SPOOLRAIL_DEDUPLICATION=false
```

## Database Queue Transactions

Spoolrail refuses to use Laravel's database Queue while that Queue's database connection has an open transaction. Commit or roll back before consuming, or route the subscription to another Queue connection:

```php
Spoolrail::subscribe('orders', 'warehouse-orders', ReserveInventory::class)
    ->onQueueConnection('redis');
```
