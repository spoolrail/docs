# Publishing Messages

## Creating a Message

Create messages with a non-empty type and an array payload:

```php
use Spoolrail\Spoolrail\Message;

$message = Message::make('order.created', [
    'order_id' => 42,
    'customer_id' => 17,
]);
```

Each message has four public values:

```php
$message->id;          // UUID v7
$message->type;        // "order.created"
$message->payload;     // The supplied array
$message->publishedAt; // null until published
```

Messages are immutable. Publishing returns a new instance with a millisecond-precision UTC `publishedAt` value; the original message remains unchanged.

## Publishing

Publish through the default connection:

```php
use Spoolrail\Spoolrail\Facades\Spoolrail;

$published = Spoolrail::publish('orders', $message);
```

Or select another connection:

```php
$published = Spoolrail::connection('partner')->publish(
    'orders',
    $message,
);
```

A publisher does not declare or select subscriptions. Every subscription already bound to the topic receives its own copy.

Spoolrail publishes immediately, including inside a database transaction. A later rollback cannot retract the message. Publish after the transaction commits, and use a transactional outbox when the database change and publication must be atomic.

## Topic Names

Topic names must contain at least three ASCII characters, begin with a letter, and otherwise contain only letters, digits, hyphens, and underscores.

Valid names include `orders`, `order_events`, and `orders-v2`. Dotted values such as `order.created` are suitable message types but are not valid topic names.

RabbitMQ uses the topic as the exchange name, so it may not exceed 255 bytes.

## Payloads and Size

Payloads must be JSON-encodable arrays. Spoolrail rejects values unsupported by `json_encode` before publishing.

The encoded message may not exceed 262,144 bytes (256 KiB). `MessageTooLargeException` exposes the actual byte count and limit. Put large documents and binary data in durable storage and publish a reference instead.

## Message Identity

Create a new `Message` for every new logical event. Publishing the same instance again reuses its UUID:

```php
$message = Message::make('order.created', ['order_id' => 42]);

Spoolrail::publish('orders', $message);
Spoolrail::publish('orders', $message); // Same message ID
```

Consumers may treat the second publication as a duplicate during the configured deduplication window.

## Publication Outcomes

The RabbitMQ driver publishes persistent messages and waits for broker confirmation. A successful call means RabbitMQ accepted the message; it does not prove that any subscription retained or handled it.

Spoolrail does not retry failed publications automatically. Catch `PublicationException` and choose a policy from its `outcome`:

```php
use Spoolrail\Spoolrail\Enums\PublicationOutcome;
use Spoolrail\Spoolrail\Exceptions\PublicationException;

try {
    $published = Spoolrail::publish('orders', $message);
} catch (PublicationException $exception) {
    $description = match ($exception->outcome) {
        PublicationOutcome::NotSent => 'The message was not sent.',
        PublicationOutcome::Rejected => 'RabbitMQ rejected the message.',
        PublicationOutcome::Unknown => 'RabbitMQ may have accepted the message.',
    };

    logger()->error($description, ['exception' => $exception]);
}
```

`NotSent` and `Rejected` establish that RabbitMQ did not accept the publication. `Unknown` means confirmation was lost after RabbitMQ may have accepted it. Retrying an `Unknown` outcome can produce another delivery, so reconcile it using your application's idempotency or outbox strategy instead of blindly publishing again.
