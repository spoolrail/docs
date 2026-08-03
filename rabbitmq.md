# RabbitMQ

See [Installation and Configuration](installation.md) for supported versions and the basic environment variables.

## Connection Settings

Publish `config/spoolrail.php` to configure the complete RabbitMQ connection:

```php
'rabbitmq' => [
    'driver' => 'rabbitmq',
    'scheme' => env('RABBITMQ_SCHEME', 'amqp'),
    'host' => env('RABBITMQ_HOST', '127.0.0.1'),
    'port' => env('RABBITMQ_PORT', 5672),
    'username' => env('RABBITMQ_USERNAME', 'guest'),
    'password' => env('RABBITMQ_PASSWORD', 'guest'),
    'vhost' => env('RABBITMQ_VHOST', '/'),
    'ca_file' => null,
    'connection_timeout' => 3,
    'publisher_confirm_timeout' => 60,
    'heartbeat' => 60,
    'prefetch' => 10,
    'management' => [
        'url' => env('RABBITMQ_MANAGEMENT_URL', 'http://127.0.0.1:15672'),
        'username' => env(
            'RABBITMQ_MANAGEMENT_USERNAME',
            env('RABBITMQ_USERNAME', 'guest'),
        ),
        'password' => env(
            'RABBITMQ_MANAGEMENT_PASSWORD',
            env('RABBITMQ_PASSWORD', 'guest'),
        ),
        'ca_file' => null,
    ],
],
```

`connection_timeout` and `heartbeat` control AMQP connections. `prefetch` limits the unacknowledged messages held by each consumer. `publisher_confirm_timeout` controls how long publishing waits before reporting an unknown outcome.

The Management URL may point to the server root or end in `/api`. It must use HTTP or HTTPS and cannot contain embedded credentials, a query string, or a fragment.

## Multiple Hosts

Use `hosts` instead of `host` to try brokers in order while opening a connection:

```php
'hosts' => [
    'rabbit-a.internal',
    'rabbit-b.internal',
],
```

Do not configure both keys. Spoolrail does not fail a publication over to another host after sending may have begun because the first broker may already have accepted it.

## TLS

The built-in scheme and port settings are already environment-driven:

```dotenv
RABBITMQ_SCHEME=amqps
RABBITMQ_PORT=5671
```

When the broker certificate is not signed by the system trust store, replace the `ca_file` value in `config/spoolrail.php` with an environment lookup:

```php
'ca_file' => env('RABBITMQ_CA_FILE'),
```

Spoolrail verifies the certificate and hostname.

Configure Management API trust separately by replacing its `ca_file` value:

```php
'ca_file' => env('RABBITMQ_MANAGEMENT_CA_FILE'),
```

## Synchronizing Topology

Subscription declarations are the source of RabbitMQ topology. Publishing and consuming do not create broker resources.

Run the synchronization command after deploying declaration changes:

```bash
php artisan spoolrail:sync
```

Spoolrail checks every referenced connection before changing any of them. It creates missing compatible resources but does not alter, recreate, or delete existing resources.

Preflight completes before any creation begins, but creation is not transactional. If a broker or network failure interrupts it, resolve the failure and rerun `spoolrail:sync`; existing compatible resources are reused.

Each topic is a durable fanout exchange. Each subscription is a durable queue named `{ownership-prefix}-{subscription}`, with one binding from its topic.

RabbitMQ's virtual-host `default_queue_type` determines whether newly created subscription queues are classic or quorum. Both queue types are supported. Quorum queues must have unlimited delivery attempts. If synchronization reports an incompatible exchange, queue, binding, or delivery limit, correct that resource deliberately or choose a new logical name before running the command again.

A publisher-only application cannot create a new topic. Synchronize at least one receiving application before enabling publication to that topic.

## Removing Subscriptions

Removing a declaration does not delete its queue. Until it is deleted, the undeclared queue remains bound to its topic and continues collecting copies of published messages. Once the queue is empty or its messages may be discarded, delete undeclared queues for one connection:

```bash
php artisan spoolrail:delete-undeclared-subscriptions --connection=rabbitmq
```

This command permanently deletes queues and their remaining messages. Pass `--connection` in deployment automation; without it, only the default connection is inspected.

After changing an ownership prefix, delete all queues under the former prefix with:

```bash
php artisan spoolrail:delete-undeclared-subscriptions \
    --connection=rabbitmq \
    --retired-prefix=warehouse-staging
```

`--retired-prefix` deletes every subscription queue under that prefix, regardless of current declarations. The current prefix cannot be supplied as retired.

## Deleting a Topic

Delete an unused topic exchange with:

```bash
php artisan spoolrail:delete-topic orders --connection=rabbitmq
```

The command succeeds only when the exchange exists, matches Spoolrail's topic requirements, and has no bindings. It does not delete subscription queues.
