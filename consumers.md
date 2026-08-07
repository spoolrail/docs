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

## Queue Handoff Idempotency

If Spoolrail completes its Laravel Queue handoff but the broker acknowledgement is lost, the broker may retry the delivery. Spoolrail recognizes the recent handoff and does not add another job.

Handoff idempotency uses locks from the Laravel cache store configured by `spoolrail.handoff_idempotency.cache_store`. It's recommended to use a `database` or `redis` store in production because they provide atomic lock release and automatically clean up expired locks.

## Database Queue Transactions

Spoolrail refuses to use Laravel's database Queue while that Queue's database connection has an open transaction. Commit or roll back before consuming, or route the subscription to another Queue connection:

```php
Spoolrail::subscribe('orders', 'warehouse-orders', ReserveInventory::class)
    ->onQueueConnection('redis');
```
