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

## Message Properties

The JSON envelope remains the portable source of message identity, type, payload, and millisecond publication time. RabbitMQ publications also project the logical message ID into AMQP `message_id`, the message type into AMQP `type`, and the publication time into AMQP `timestamp` so RabbitMQ tooling can display those values. AMQP timestamps have one-second resolution.

These properties remain publisher-supplied projections. They do not populate the receive-side transport-assigned ID or publication-time fields, which are `null` for RabbitMQ. Portable publication headers use AMQP application headers and are available through the received message's transport context.

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

## Managed Topology

After declaring subscriptions, run [topology synchronization](subscriptions.md#synchronizing-topology) with the Management API credentials configured for the connection. For each declaration, Spoolrail creates or verifies:

- a durable fanout exchange named `{topic}`;
- a durable queue named `{ownership-prefix}-{subscription}`; and
- a binding from the topic exchange to the subscription queue.

RabbitMQ's virtual-host `default_queue_type` determines whether newly created subscription queues are classic or quorum. Both queue types are supported. Quorum queues must have unlimited delivery attempts. If synchronization reports an incompatible exchange, queue, binding, or delivery limit, correct that resource deliberately or choose a new logical name before running the command again.
