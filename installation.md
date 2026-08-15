# Installation and Configuration

## Requirements

Spoolrail requires PHP 8.4 or later with the PCNTL extension, Laravel 12 or later, and a configured Laravel Queue connection.

## Installation

Install Spoolrail using Composer:

```bash
composer require spoolrail/spoolrail
```

Laravel discovers the package's service provider automatically.

Publish `config/spoolrail.php` when you need to customize Spoolrail's settings:

```bash
php artisan vendor:publish --tag=spoolrail-config
```

## Application Environment

Select the default connection and set a stable ownership prefix for subscription resources:

```dotenv
SPOOLRAIL_CONNECTION=rabbitmq
SPOOLRAIL_PREFIX=warehouse-production
```

`SPOOLRAIL_CONNECTION` names a connection from `config/spoolrail.php`. The bundled broker connections are `rabbitmq`, `snssqs`, and `pubsub`.

`SPOOLRAIL_PREFIX` namespaces subscription resources owned by the application. Set it explicitly before consuming messages or managing subscriptions and keep it stable. Publisher-only applications do not need it.

Choose a short value from the application's durable identity. It is recommended to keep the prefix independent of `APP_NAME` because changing the prefix requires migrating subscriptions. It must begin with an ASCII letter, contain only ASCII letters, digits, hyphens, and underscores, and contain at most 24 characters.

Use a different prefix for every receiving application sharing a transport scope. Give environments distinct prefixes only when they deliberately share that scope. Changing the prefix creates a new set of subscription resources and leaves the old resources in place.

The ownership prefix is reserved for Spoolrail-managed subscription resources. Undeclared-subscription cleanup treats every resource in that namespace as application-owned and may delete it when no active subscription declares it.

## Driver Prerequisites

Each broker driver has its own client dependency and environment prerequisites. Follow the guide for every driver the application uses:

- [RabbitMQ](rabbitmq.md#driver-prerequisites)
- [AWS SNS/SQS](snssqs.md#driver-prerequisites)
- [Google Pub/Sub](pubsub.md#driver-prerequisites)

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

## Transactional Outbox

Direct broker publication is the default. See [Transactional Outbox](outbox.md) when publications must commit atomically with database changes.

## Array Connection

The `array` connection is an in-process transport for tests. It cannot exchange messages between PHP processes. See [Testing](testing.md).
