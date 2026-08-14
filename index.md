# Spoolrail

Spoolrail lets Laravel applications exchange messages through a broker without giving up Laravel Queue for background work.

A publisher sends a `Message` to a topic. Every subscription to that topic gets its own copy. The long-running `php artisan spoolrail` command hands each copy to the Laravel Queue selected by the subscription, where the message handler runs.

## Quick Start

This walkthrough assumes your Laravel application can reach a RabbitMQ server with the Management plugin enabled. See [Installation and Configuration](installation.md) for supported versions, TLS, and advanced connection settings.

### 1. Install Spoolrail

```bash
composer require spoolrail/spoolrail
composer require php-amqplib/php-amqplib:^3.7.4
```

### 2. Configure RabbitMQ

Add the connection and a stable ownership prefix to `.env`:

```dotenv
SPOOLRAIL_PREFIX=warehouse-local

RABBITMQ_HOST=127.0.0.1
RABBITMQ_USERNAME=spoolrail
RABBITMQ_PASSWORD=secret
RABBITMQ_VHOST=spoolrail

RABBITMQ_MANAGEMENT_URL=http://127.0.0.1:15672
```

The ownership prefix distinguishes this application's subscription queues from queues owned by other applications and environments.

### 3. Create a Handler

Handlers implement `MessageHandler` and are resolved through Laravel's service container:

```php
<?php

namespace App\Spoolrail\Handlers;

use App\Services\Inventory;
use Spoolrail\Spoolrail\Contracts\MessageHandler;
use Spoolrail\Spoolrail\Message;

class ReserveInventory implements MessageHandler
{
    public function __construct(
        private readonly Inventory $inventory,
    ) {}

    public function handle(Message $message): void
    {
        $this->inventory->reserve(
            (int) $message->payload['order_id'],
        );
    }
}
```

### 4. Declare a Subscription

Create `routes/subscriptions.php`:

```php
<?php

use App\Spoolrail\Handlers\ReserveInventory;
use Spoolrail\Spoolrail\Facades\Spoolrail;

Spoolrail::subscribe(
    topic: 'orders',
    name: 'warehouse-orders',
    handler: ReserveInventory::class,
);
```

Spoolrail loads this file automatically.

### 5. Create the Broker Resources

```bash
php artisan spoolrail:sync
```

Run this command during deployment whenever subscription declarations change.

### 6. Start the Workers

Run consumers for every subscription on the default Spoolrail connection:

```bash
php artisan spoolrail
```

Make sure Laravel Queue workers are running for the connections and queues selected by your subscriptions.

### 7. Publish a Message

```php
use Spoolrail\Spoolrail\Facades\Spoolrail;
use Spoolrail\Spoolrail\Message;

$published = Spoolrail::publish(
    'orders',
    Message::make('order.created', [
        'order_id' => $order->id,
    ]),
);
```

The returned message contains the UUID and UTC publication time that subscribers receive.

## Where to Go Next

- [Installation and Configuration](installation.md)
- [Publishing Messages](messages.md)
- [Transactional Outbox](outbox.md)
- [Subscriptions and Handlers](subscriptions.md)
- [Running Consumers](consumers.md)
- [RabbitMQ](rabbitmq.md)
- [AWS SNS/SQS](snssqs.md)
- [Testing](testing.md)
- [Custom Drivers](extending.md)
