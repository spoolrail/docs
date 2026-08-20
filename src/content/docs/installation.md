---
title: Installation and Configuration
description: Install Spoolrail and configure connections, ownership, and driver prerequisites.
---

## Requirements

Spoolrail requires PHP 8.4 or later with the PCNTL extension, Laravel 12 or later, and a configured Laravel queue connection.

## Installation

Install Spoolrail using Composer:

```bash
composer require spoolrail/spoolrail
```

Laravel discovers the package's service provider automatically.

## Publish Spoolrail Files

```bash
php artisan spoolrail:install
```

The install command publishes `config/spoolrail.php` and creates `routes/subscriptions.php`. Add `--migrations` to also publish the outbox migration. Existing files remain unchanged unless you pass `--force`, which replaces every requested file with the package version.

## Application Environment

Select the default connection and set a stable ownership prefix for subscription resources:

```dotenv
SPOOLRAIL_CONNECTION=rabbitmq
SPOOLRAIL_PREFIX=warehouse
```

`SPOOLRAIL_CONNECTION` names a connection from `config/spoolrail.php`. The bundled broker connections are `rabbitmq`, `snssqs`, and `pubsub`.

`SPOOLRAIL_PREFIX` namespaces subscription resources owned by the application. Set it before consuming messages or managing subscriptions, and keep it stable. Publisher-only applications do not need it.

Use a short, stable identifier for the application. Keep it independent of `APP_NAME` because changing the prefix requires migrating subscriptions. It must contain at most 24 characters (letters, digits, hyphens, and underscores are allowed).

Changing the prefix makes Spoolrail address different subscription resources. After you run `spoolrail:sync` to create them, resources under the old prefix remain subscribed and may keep collecting messages until you [remove them](/subscriptions/#removing-resources).

The ownership prefix is reserved for Spoolrail-managed subscription resources. Undeclared-subscription cleanup treats every resource in that namespace as application-owned and may delete it when no active subscription declares it.

## Driver Prerequisites

Each broker driver has its own client dependency and environment prerequisites. Follow the guide for every driver the application uses:

- [RabbitMQ](/rabbitmq/#driver-prerequisites)
- [AWS SNS/SQS](/snssqs/#driver-prerequisites)
- [Google Pub/Sub](/pubsub/#driver-prerequisites)

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

This publishes through the `partner` connection. The default connection remains unchanged.

Or assign a subscription to it:

```php
Spoolrail::subscribe('orders', 'partner-orders', ProcessPartnerOrderHandler::class)
    ->onConnection('partner');
```

## Transactional Outbox

Direct broker publication is the default. See [Transactional Outbox](/outbox/) when publications must commit atomically with database changes.

## Array Connection

The `array` connection is an in-process transport for tests. It cannot exchange messages between PHP processes. See [Testing](/testing/).
