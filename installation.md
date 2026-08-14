# Installation and Configuration

## Requirements

Spoolrail requires PHP 8.4 or later with the PCNTL extension, Laravel 12 or later, and a configured Laravel Queue connection.

The RabbitMQ driver requires RabbitMQ 4.3 or later and `php-amqplib/php-amqplib` 3.7.4 or later. Topology commands also require the RabbitMQ Management plugin and access to its HTTP API.

The AWS SNS/SQS driver requires `aws/aws-sdk-php` 3.392.0 or later.

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

Applications using AWS SNS/SQS must install the AWS SDK:

```bash
composer require aws/aws-sdk-php:^3.392.0
```

Publish `config/spoolrail.php` when you need to customize Spoolrail's settings:

```bash
php artisan vendor:publish --tag=spoolrail-config
```

## RabbitMQ Environment

The bundled `rabbitmq` connection reads these environment variables:

```dotenv
SPOOLRAIL_CONNECTION=rabbitmq
SPOOLRAIL_PREFIX=warehouse-production

RABBITMQ_SCHEME=amqp
RABBITMQ_HOST=127.0.0.1
RABBITMQ_PORT=5672
RABBITMQ_USERNAME=application
RABBITMQ_PASSWORD=secret

RABBITMQ_MANAGEMENT_URL=http://127.0.0.1:15672
```

By default, Spoolrail uses the RabbitMQ username and password for both AMQP and the Management API.

See [RabbitMQ](rabbitmq.md) for multiple hosts, TLS, and separate topology management credentials.

## AWS SNS/SQS Environment

The bundled `snssqs` connection reads the common AWS credential variables and requires the resource owner's account ID in addition to the Region:

```dotenv
SPOOLRAIL_CONNECTION=snssqs
SPOOLRAIL_PREFIX=warehouse-production

AWS_ACCESS_KEY_ID=<your-key-id>
AWS_SECRET_ACCESS_KEY=<your-secret-access-key>
AWS_DEFAULT_REGION=us-east-1
AWS_ACCOUNT_ID=123456789012
```

The account ID addresses resources. Define `AWS_SESSION_TOKEN` as well when using temporary credentials. Applications using the AWS SDK's default credential provider chain, such as an IAM role, may omit all three credential variables. See [AWS SNS/SQS](snssqs.md) for the complete connection, FIFO behavior, permissions, custom endpoints, and topology management.

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

## Transactional Outbox

Direct broker publication is the default. See [Transactional Outbox](outbox.md) when publications must commit atomically with database changes.

## Array Connection

The `array` connection is an in-process transport for tests. It cannot exchange messages between PHP processes. See [Testing](testing.md).
