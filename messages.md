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

By default, Spoolrail publishes immediately, including inside a database transaction. You can enable the [Transactional Outbox](outbox.md) when a database change and publication must be atomic. With the outbox enabled, the publishing call stores the publication without contacting the broker, so the change and pending publication are committed together, or neither is. A separate outbox dispatcher process publishes pending publications to the broker.

## Publication Retries

By default, Spoolrail retries broker publication failures up to two times, waiting one second between attempts, unless the broker rejects the publication for a permanent reason.

In the rare case where the broker accepts the message but its response does not reach Spoolrail due to a transient failure, a retry can publish the same message again. Spoolrail [deduplicates recent repeats during Queue handoff](consumers.md#message-delivery).

Retries can extend how long direct publishing waits during a broker failure. Configure them under `spoolrail.publisher_retries`.

When the transactional outbox is enabled, the same retry behavior applies when the outbox dispatcher publishes the message. If those retries are exhausted, the publication remains pending for a later scheduled run.

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

## Ordering Keys

Pass an ordering key when a topic contains independent groups that may progress in parallel but must remain ordered within each group:

```php
$published = Spoolrail::publish(
    'orders',
    $message,
    orderingKey: "order:{$order->id}",
);
```

Use the named fourth argument; `headers` remains the third argument and does not need an empty placeholder. A key must contain between 1 and 128 printable ASCII characters without spaces.

Ordering keys are not stored on `Message` or automatically reused when publishing a received message. Pass the key explicitly when the new publication should use it.

Drivers use the key as follows:

- RabbitMQ and the `array` driver accept and ignore the key with no warning.
- AWS FIFO keeps messages with the same key in one ordered group and uses one topic-wide group when the key is omitted.
- AWS standard forwards a supplied key to SQS for fair-queue tenant grouping without ordering or deduplication.
- Google Pub/Sub keeps messages with the same key in one ordered lane when ordering is enabled and uses one topic-wide lane when the key is omitted. When ordering is disabled, it still forwards a supplied key without making an ordering promise.

Ordering-capable transports preserve broker-to-Laravel-Queue handoff order within a group, not across groups or subscriptions. Laravel Queue concurrency and retries may change handler execution or completion order. See [AWS FIFO Mode and Ordering](snssqs.md#fifo-mode-and-ordering) and [Pub/Sub Message Ordering](pubsub.md#message-ordering) for provider-specific behavior and throughput limits.

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
$message->transport?->orderingKey;
```

`driver`, `connectionName`, `topic`, `subscription`, and `headers` are always present on received messages. `headers` is an `array<string, mixed>` containing the complete native header collection exposed by the transport, including transport-added values, or an empty array when the delivery has none. It can therefore contain more than 10 entries and values other than strings.

`transportMessageId`, `transportPublishedAt`, `redelivered`, and `orderingKey` are nullable because a transport may not report those facts. A transport message ID is assigned by the transport and is distinct from the logical `$message->id`. A transport publication time is assigned by the transport and is distinct from the application-side `$message->publishedAt`. RabbitMQ and the `array` driver report `null` for the transport-assigned ID, publication time, and ordering key; they report redelivery evidence when available. AWS reports the SQS message ID, sent time, approximate redelivery evidence, and native message group. Google Pub/Sub reports the Pub/Sub message ID, service publication time, delivery-attempt evidence when available, and ordering key.

`redelivered` is diagnostic context. `true` means the transport marked this source delivery as repeated, `false` means it did not, and `null` means the transport cannot say. It does not count Laravel Queue attempts or establish whether the handler has already completed.

Laravel Queue retries retain the context captured during the successful broker-to-Queue handoff. A source transport redelivery creates a fresh context for the new delivery. Context never contains an acknowledgement or receipt handle and cannot be used by handlers to settle the source delivery.
