# RabbitMQ

The RabbitMQ driver publishes each topic to a fanout exchange and gives every Spoolrail subscription its own queue.

## Driver Prerequisites

The driver requires RabbitMQ 4.3 or later and `php-amqplib/php-amqplib` 3.7.4 or later. Install the AMQP client using Composer:

```bash
composer require php-amqplib/php-amqplib:^3.7.4
```

Topology commands also require the RabbitMQ Management plugin and access to its HTTP API.

Configure the RabbitMQ connection in `.env`:

```dotenv
RABBITMQ_SCHEME=amqp
RABBITMQ_HOST=127.0.0.1
RABBITMQ_PORT=5672
RABBITMQ_USERNAME=application
RABBITMQ_PASSWORD=secret
RABBITMQ_VHOST=/

RABBITMQ_MANAGEMENT_URL=http://127.0.0.1:15672
```

By default, Spoolrail uses the RabbitMQ username and password for both AMQP and the Management API.

## Configuration

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

`connection_timeout` and `heartbeat` control AMQP connections. `prefetch` limits the unacknowledged messages held by each consumer. `publisher_confirm_timeout` controls how long each publication attempt waits for broker confirmation.

The Management URL may point to the server root or end in `/api`. It must use HTTP or HTTPS and cannot contain embedded credentials, a query string, or a fragment.

## Message Properties

The JSON envelope carries the portable message identity, type, payload, and millisecond publication time. RabbitMQ publications also copy the logical message ID to AMQP `message_id`, the message type to AMQP `type`, and the publication time to AMQP `timestamp` so RabbitMQ tooling can display them. AMQP timestamps have one-second resolution.

RabbitMQ does not treat these publisher-supplied properties as transport-assigned values. The receive-side transport ID and publication time remain `null`. Portable publication headers use AMQP application headers and are available through the received message's transport context.

## Multiple Hosts

Use `hosts` instead of `host` to try brokers in order while opening a connection:

```php
'hosts' => [
    'rabbit-a.internal',
    'rabbit-b.internal',
],
```

Configure either `host` or `hosts`, not both. List only nodes from the same RabbitMQ cluster. A publication retry may reconnect through the next host after an earlier attempt was not confirmed.

## TLS

Set the scheme and port in `.env`:

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

RabbitMQ's virtual-host `default_queue_type` determines whether newly created subscription queues are classic or quorum. Both queue types are supported. Quorum queues must have unlimited delivery attempts. If synchronization reports an incompatible exchange, queue, binding, or delivery limit, fix that resource or choose a new logical name before running the command again.
