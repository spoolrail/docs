# Installation and Configuration

## Requirements

Spoolrail requires PHP 8.4 or later, Laravel 12 or 13, and a configured Laravel Queue connection.

The RabbitMQ driver requires RabbitMQ 4.3 or later and `php-amqplib/php-amqplib` 3.7.4 or later. Topology commands also require the RabbitMQ Management plugin and HTTP API.

## Installation

Install Spoolrail using Composer:

```bash
composer require spoolrail/spoolrail
```

Laravel discovers the package's service provider automatically.

Applications using RabbitMQ must also install its AMQP client:

```bash
composer require php-amqplib/php-amqplib:^3.7.4
```

Publish `config/spoolrail.php` when you need to change connection, TLS, or deduplication settings:

```bash
php artisan vendor:publish --tag=spoolrail-config
```

## RabbitMQ Environment

The bundled `rabbitmq` connection reads these environment variables:

```dotenv
SPOOLRAIL_CONNECTION=rabbitmq
SPOOLRAIL_PREFIX=warehouse-production

RABBITMQ_SCHEME=amqp
RABBITMQ_HOST=rabbit.internal
RABBITMQ_PORT=5672
RABBITMQ_USERNAME=application
RABBITMQ_PASSWORD=secret
RABBITMQ_VHOST=orders

RABBITMQ_MANAGEMENT_URL=http://rabbit.internal:15672
RABBITMQ_MANAGEMENT_USERNAME=topology
RABBITMQ_MANAGEMENT_PASSWORD=secret
```

The AMQP credentials publish and consume messages. The Management credentials inspect and change broker topology. When Management credentials are omitted, Spoolrail uses the AMQP credentials.

See [RabbitMQ](rabbitmq.md) for multiple hosts, TLS, and topology management.

## Ownership Prefix

`SPOOLRAIL_PREFIX` namespaces subscription queues owned by the application. Set it explicitly before consuming messages or managing subscriptions and keep it stable:

```dotenv
SPOOLRAIL_PREFIX=warehouse-production
```

It is required when consuming messages or managing receive-side topology, but publisher-only applications do not need it.

Choose a short value from the application's durable identity. It is recommended to keep the prefix independent of `APP_NAME` because changing the prefix requires migrating subscriptions. It must begin with an ASCII letter, contain only ASCII letters, digits, hyphens, and underscores, and contain at most 24 characters.

Use a different prefix for every receiving application sharing a transport scope. Give environments distinct prefixes only when they deliberately share that scope. Changing the prefix creates a new set of subscription resources and leaves the old resources in place.

The ownership prefix is reserved for Spoolrail-managed subscription resources. Undeclared-subscription cleanup treats every resource in that namespace as application-owned and may delete it when no active subscription declares it.

## Multiple Connections

Define additional connections in `config/spoolrail.php`:

```php
'connections' => [
    'primary' => [
        'driver' => 'rabbitmq',
        // ...
    ],

    'partner' => [
        'driver' => 'rabbitmq',
        // ...
    ],
],
```

Select a connection when publishing:

```php
Spoolrail::connection('partner')->publish('orders', $message);
```

Or assign a subscription to it:

```php
Spoolrail::subscribe('orders', 'partner-orders', HandlePartnerOrder::class)
    ->onConnection('partner');
```

Changing a resolved connection's configuration at runtime does not rebuild it automatically. Call `Spoolrail::forgetConnection('partner')` when a test or long-running process must reconnect with new settings.

## Deduplication

Deduplication is enabled by default and uses the configured Laravel cache store. Production workers must share a cache store that supports atomic locks.

See [Duplicate Handling](consumers.md#duplicate-handling) before changing `spoolrail.deduplication` settings.

## Array Connection

The `array` connection is an in-process transport for tests. It cannot exchange messages between PHP processes. See [Testing](testing.md).
