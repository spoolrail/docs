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

Each message has five public values:

```php
$message->id;          // UUID v7
$message->type;        // "order.created"
$message->payload;     // The supplied array
$message->publishedAt; // null until published
$message->transport;   // null until received from a transport
```

Messages are immutable. Publishing returns a new instance with a millisecond-precision UTC `publishedAt` value and no transport context; the original message remains unchanged.

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

## Publication Headers

Pass portable string headers when a publication needs tracing or application metadata outside the logical message:

```php
$published = Spoolrail::publish(
    'orders',
    $message,
    headers: [
        'traceparent' => $traceparent,
        'correlation-id' => (string) $order->id,
    ],
);
```

Use lowercase kebab-case keys and string values. Publications accept up to 10 headers, the AWS SNS-to-SQS portability limit.

Headers belong to a publication, not to `Message`. They are not encoded in the JSON envelope or retained on the returned message. Publishing a received message does not automatically forward its received headers; pass the selected headers explicitly.

## Topic Names

Topic names must contain between 3 and 251 ASCII characters, begin with a letter, and otherwise contain only letters, digits, hyphens, and underscores.

Valid names include `orders`, `order_events`, and `orders-v2`. Dotted values such as `order.created` are suitable message types but are not valid topic names.

## Payloads and Size

Payloads must be JSON-encodable arrays. Spoolrail rejects values unsupported by `json_encode` before publishing.

The complete publication, including headers, may not exceed 256 KiB. `MessageTooLargeException` exposes the actual byte count and limit. Put large documents and binary data in durable storage and publish a reference instead.

## Message Identity

Create a new `Message` for every new logical event. Publishing the same instance again reuses its UUID:

```php
$message = Message::make('order.created', ['order_id' => 42]);

Spoolrail::publish('orders', $message);
Spoolrail::publish('orders', $message); // Same message ID
```

Consumers may treat the second publication as a duplicate during the configured deduplication window.

## Transport Context

A message received by a handler has an immutable `TransportContext` describing that delivery:

```php
$message->transport?->driver;
$message->transport?->connectionName;
$message->transport?->topic;
$message->transport?->subscription;
$message->transport?->headers;
$message->transport?->transportMessageId;
$message->transport?->transportPublishedAt;
$message->transport?->redelivered;
```

`driver`, `connectionName`, `topic`, `subscription`, and `headers` are always present on received messages. `headers` is an `array<string, mixed>` containing the complete native header collection exposed by the transport, including transport-added values, or an empty array when the delivery has none. It can therefore contain more than 10 entries and values other than strings.

`transportMessageId`, `transportPublishedAt`, and `redelivered` are nullable because a transport may not report those facts. A transport message ID is assigned by the transport and is distinct from the logical `$message->id`. A transport publication time is assigned by the transport and is distinct from the application-side `$message->publishedAt`. RabbitMQ and the Array driver report `null` for both transport-assigned fields. The Array driver and RabbitMQ report redelivery evidence when available.

`redelivered` is diagnostic context. `true` means the transport marked this source delivery as repeated, `false` means it did not, and `null` means the transport cannot say. It does not count Laravel Queue attempts or establish whether the handler has already completed.

Laravel Queue retries retain the context captured during the successful broker-to-Queue handoff. A source transport redelivery creates a fresh context for the new delivery. Context never contains an acknowledgement or receipt handle and cannot be used by handlers to settle the source delivery.

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
